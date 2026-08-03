import { SESSION_STATUS, type LocalAgentStatusEvent, type LocalAgentTargetMetadata } from "./types";

export { deriveSlotColor, SESSION_SLOT_COLOR } from "./colors";

export const SESSION_REDUCER_ACTION = {
  EVENT: "event",
  PHYSICAL_KEY_DOWN: "physical-key-down",
  PANE_MISSING: "pane-missing",
} as const;

export const SESSION_REDUCER_LIMITS = {
  SLOT_COUNT: 5,
  RETIRED_SESSION_LIMIT: 16,
} as const;

export interface SessionSlot {
  readonly index: number;
  readonly assignmentId?: string;
  readonly sessionId?: string;
  readonly source?: LocalAgentStatusEvent["source"];
  readonly lifecycle?: LocalAgentStatusEvent["lifecycle"];
  readonly target?: LocalAgentTargetMetadata;
  readonly runningSince?: number;
  readonly acknowledged?: boolean;
  readonly lastEventId?: string;
  readonly lastTimestamp?: number;
  readonly lastSequence?: number;
}

export interface RetiredSession {
  readonly sessionId: string;
  readonly lastEventId: string;
  readonly lastTimestamp: number;
  readonly lastSequence?: number;
}

export interface SessionState {
  readonly slots: readonly SessionSlot[];
  readonly retiredSessions: readonly RetiredSession[];
}

export interface SessionEventAction {
  readonly kind: typeof SESSION_REDUCER_ACTION.EVENT;
  readonly event: LocalAgentStatusEvent;
}

export interface PhysicalKeyDownAction {
  readonly kind: typeof SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN;
  readonly slotIndex: number;
  readonly sessionId?: string;
  readonly target?: LocalAgentTargetMetadata;
  readonly assignmentId?: string;
}

export interface PaneMissingAction {
  readonly kind: typeof SESSION_REDUCER_ACTION.PANE_MISSING;
  readonly slotIndex: number;
  readonly sessionId: string;
  readonly target: LocalAgentTargetMetadata;
  readonly assignmentId: string;
}

export type SessionReducerAction = SessionEventAction | PhysicalKeyDownAction | PaneMissingAction;

function copyTarget(target: LocalAgentTargetMetadata): LocalAgentTargetMetadata {
  const copied = {
    tmuxPaneId: target.tmuxPaneId,
    tmuxSession: target.tmuxSession,
    ghosttyBundleId: target.ghosttyBundleId,
  };
  return Object.freeze(target.tmuxWindow === undefined ? copied : { ...copied, tmuxWindow: target.tmuxWindow });
}

function freezeState(slots: readonly SessionSlot[], retiredSessions: readonly RetiredSession[]): SessionState {
  return Object.freeze({
    slots: Object.freeze(slots.map((slot) => Object.freeze({ ...slot }))),
    retiredSessions: Object.freeze(retiredSessions.map((session) => Object.freeze({ ...session }))),
  });
}

function isNewer(lastTimestamp: number, lastSequence: number | undefined, event: LocalAgentStatusEvent): boolean {
  if (event.timestamp !== lastTimestamp) return event.timestamp > lastTimestamp;
  return event.sequence !== undefined && lastSequence !== undefined && event.sequence > lastSequence;
}

function isDuplicateOrStale(
  lastEventId: string,
  lastTimestamp: number | undefined,
  lastSequence: number | undefined,
  event: LocalAgentStatusEvent,
): boolean {
  return lastEventId === event.eventId || lastTimestamp === undefined || !isNewer(lastTimestamp, lastSequence, event);
}

function slotFromEvent(index: number, event: LocalAgentStatusEvent, assignmentId: string, runningSince?: number): SessionSlot {
  const startsRunning = event.lifecycle === SESSION_STATUS.STARTED;
  const isRunning = startsRunning || event.lifecycle === SESSION_STATUS.RUNNING;
  return {
    index,
    assignmentId,
    sessionId: event.sessionId,
    source: event.source,
    lifecycle: event.lifecycle,
    target: copyTarget(event.target),
    ...(isRunning ? { runningSince: startsRunning ? event.timestamp : (runningSince ?? event.timestamp) } : {}),
    acknowledged: false,
    lastEventId: event.eventId,
    lastTimestamp: event.timestamp,
    ...(event.sequence === undefined ? {} : { lastSequence: event.sequence }),
  };
}

function retiredFrom(event: LocalAgentStatusEvent): RetiredSession {
  return {
    sessionId: event.sessionId,
    lastEventId: event.eventId,
    lastTimestamp: event.timestamp,
    ...(event.sequence === undefined ? {} : { lastSequence: event.sequence }),
  };
}

function addRetired(retiredSessions: readonly RetiredSession[], event: LocalAgentStatusEvent): readonly RetiredSession[] {
  return [...retiredSessions.filter((session) => session.sessionId !== event.sessionId), retiredFrom(event)]
    .slice(-SESSION_REDUCER_LIMITS.RETIRED_SESSION_LIMIT);
}

function addRetiredSlot(retiredSessions: readonly RetiredSession[], slot: SessionSlot): readonly RetiredSession[] {
  if (slot.sessionId === undefined || slot.lastEventId === undefined || slot.lastTimestamp === undefined) return retiredSessions;
  const retired: RetiredSession = {
    sessionId: slot.sessionId,
    lastEventId: slot.lastEventId,
    lastTimestamp: slot.lastTimestamp,
    ...(slot.lastSequence === undefined ? {} : { lastSequence: slot.lastSequence }),
  };
  return [...retiredSessions.filter((session) => session.sessionId !== slot.sessionId), retired]
    .slice(-SESSION_REDUCER_LIMITS.RETIRED_SESSION_LIMIT);
}

function matchesAssignment(slot: SessionSlot | undefined, sessionId: string, target: LocalAgentTargetMetadata, assignmentId: string): boolean {
  return slot?.sessionId === sessionId && slot.assignmentId === assignmentId && slot.target?.tmuxPaneId === target.tmuxPaneId && slot.target.tmuxSession === target.tmuxSession && slot.target.tmuxWindow === target.tmuxWindow && slot.target.ghosttyBundleId === target.ghosttyBundleId;
}

function reduceEvent(state: SessionState, event: LocalAgentStatusEvent): SessionState {
  const slotIndex = state.slots.findIndex((slot) => slot.sessionId === event.sessionId);
  if (slotIndex >= 0) {
    const slot = state.slots[slotIndex];
    if (slot === undefined || isDuplicateOrStale(slot.lastEventId ?? "", slot.lastTimestamp, slot.lastSequence, event)) {
      return state;
    }
    if (event.lifecycle === SESSION_STATUS.PANE_DISAPPEARED) {
      const slots = state.slots.map((current) => current.index === slotIndex ? { index: slotIndex } : current);
      return freezeState(slots, addRetired(state.retiredSessions, event));
    }
    const slots = state.slots.map((current) => current.index === slotIndex ? slotFromEvent(slotIndex, event, slot.assignmentId ?? event.eventId, slot.runningSince) : current);
    return freezeState(slots, state.retiredSessions);
  }

  const retired = state.retiredSessions.find((session) => session.sessionId === event.sessionId);
  if (retired !== undefined) {
    if (event.lifecycle !== SESSION_STATUS.STARTED || isDuplicateOrStale(retired.lastEventId, retired.lastTimestamp, retired.lastSequence, event)) {
      return state;
    }
  } else if (event.lifecycle === SESSION_STATUS.PANE_DISAPPEARED) {
    return state;
  }

  const freeSlot = state.slots.find((slot) => slot.sessionId === undefined);
  if (freeSlot === undefined) return state;
  const slots = state.slots.map((slot) => slot.index === freeSlot.index ? slotFromEvent(slot.index, event, event.eventId) : slot);
  const retiredSessions = retired === undefined
    ? state.retiredSessions
    : state.retiredSessions.filter((session) => session.sessionId !== event.sessionId);
  return freezeState(slots, retiredSessions);
}

function reducePhysicalKeyDown(
  state: SessionState,
  slotIndex: number,
  sessionId?: string,
  target?: LocalAgentTargetMetadata,
  assignmentId?: string,
): SessionState {
  const slot = state.slots[slotIndex];
  if ((sessionId !== undefined || target !== undefined || assignmentId !== undefined) && (sessionId === undefined || target === undefined || assignmentId === undefined || !matchesAssignment(slot, sessionId, target, assignmentId))) return state;
  if (slot?.lifecycle !== SESSION_STATUS.COMPLETED || slot.acknowledged) return state;
  const slots = state.slots.map((current) => current.index === slotIndex ? { ...current, acknowledged: true } : current);
  return freezeState(slots, state.retiredSessions);
}

function reducePaneMissing(state: SessionState, action: PaneMissingAction): SessionState {
  const slot = state.slots[action.slotIndex];
  if (slot === undefined || !matchesAssignment(slot, action.sessionId, action.target, action.assignmentId)) return state;
  const slots = state.slots.map((current) => current.index === action.slotIndex ? { index: action.slotIndex } : current);
  return freezeState(slots, addRetiredSlot(state.retiredSessions, slot));
}

export function createSessionState(): SessionState {
  const slots = Array.from({ length: SESSION_REDUCER_LIMITS.SLOT_COUNT }, (_, index) => ({ index }));
  return freezeState(slots, []);
}

export function reduceSessionState(state: SessionState, action: SessionReducerAction): SessionState {
  if (action.kind === SESSION_REDUCER_ACTION.EVENT) return reduceEvent(state, action.event);
  if (action.kind === SESSION_REDUCER_ACTION.PANE_MISSING) return reducePaneMissing(state, action);
  return reducePhysicalKeyDown(state, action.slotIndex, action.sessionId, action.target, action.assignmentId);
}
