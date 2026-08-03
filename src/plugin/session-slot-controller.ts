import streamDeck, { type KeyAction, type WillAppearEvent } from "@elgato/streamdeck";

import {
  SESSION_REDUCER_ACTION,
  createSessionState,
  deriveSlotColor,
  reduceSessionState,
  SESSION_REDUCER_LIMITS,
  type SessionState,
} from "../core/reducer";
import { SESSION_SLOT_COLOR, SESSION_SLOT_SVG_PAINT, type SessionSlotColor } from "../core/colors";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../core/types";
import {
  NAVIGATION_OUTCOME,
  ghosttyTmuxNavigator,
  type AssignedTargetNavigator,
  type NavigationOutcome,
} from "../navigation/ghostty-tmux";

const SESSION_SLOT_IMAGE = {
  PREFIX: "data:image/svg+xml;base64,",
  SIZE: 72,
  ROW: 0,
} as const;

const SESSION_SLOT_RENDER_RESULT = {
  SKIPPED: "skipped",
  RENDERED: "rendered",
  FAILED: "failed",
} as const;

type SessionSlotRenderResult = (typeof SESSION_SLOT_RENDER_RESULT)[keyof typeof SESSION_SLOT_RENDER_RESULT];

export const SESSION_SLOT_RENDER_RETRY_DELAY_MS = 50;
export const SESSION_SLOT_RENDER_ERROR = "Session slot render failed.";
export const SESSION_SLOT_NAVIGATION_ERROR = "Session slot navigation unavailable.";
export const SESSION_SLOT_PERSISTENCE_ERROR = "Session slot state subscriber failed.";

export type SessionStateSubscriber = (state: SessionState) => void | Promise<void>;

export interface SessionSlotClock {
  now(): number;
}

export interface SessionSlotScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface SessionSlotLogger {
  error(message: string): void;
}

export interface SessionSlotControllerOptions {
  readonly clock: SessionSlotClock;
  readonly scheduler: SessionSlotScheduler;
  readonly logger: SessionSlotLogger;
  readonly navigator?: AssignedTargetNavigator;
}

const productionControllerOptions: SessionSlotControllerOptions = {
  clock: { now: Date.now },
  scheduler: {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  logger: {
    error: (message) => streamDeck.logger.error(message),
  },
  navigator: ghosttyTmuxNavigator,
};

interface VisibleSessionSlot {
  readonly action: KeyAction;
  readonly slotIndex: number;
  renderGeneration: number;
  retryGeneration: number;
  renderedColor?: SessionSlotColor;
  retryTimer?: unknown;
}

function isSlotIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < SESSION_REDUCER_LIMITS.SLOT_COUNT;
}

function slotIndexFor(event: WillAppearEvent): number | undefined {
  if (event.payload.controller !== "Keypad") return undefined;
  const coordinates = event.action instanceof Object && "coordinates" in event.action
    ? (event.action as KeyAction).coordinates
    : undefined;
  if (coordinates?.row !== SESSION_SLOT_IMAGE.ROW || !isSlotIndex(coordinates?.column ?? -1)) return undefined;
  return coordinates.column;
}

export function sessionSlotSvgDataUri(color: SessionSlotColor): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SESSION_SLOT_IMAGE.SIZE} ${SESSION_SLOT_IMAGE.SIZE}"><rect width="${SESSION_SLOT_IMAGE.SIZE}" height="${SESSION_SLOT_IMAGE.SIZE}" fill="${SESSION_SLOT_SVG_PAINT[color]}"/></svg>`;
  return `${SESSION_SLOT_IMAGE.PREFIX}${Buffer.from(svg).toString("base64")}`;
}

export class SessionSlotController {
  #state = createSessionState();
  #visibleActions = new Map<string, VisibleSessionSlot>();
  #stateSubscriber: SessionStateSubscriber | undefined = undefined;

  constructor(private readonly options: SessionSlotControllerOptions = productionControllerOptions) {}

  get state(): SessionState {
    return this.#state;
  }

  get visibleContextCount(): number {
    return this.#visibleActions.size;
  }

  subscribeToStateChanges(subscriber: SessionStateSubscriber): () => void {
    this.#stateSubscriber = subscriber;
    return () => { if (this.#stateSubscriber === subscriber) this.#stateSubscriber = undefined; };
  }

  async hydrateState(state: SessionState): Promise<void> {
    this.#state = state;
    await this.refresh(this.options.clock.now());
  }

  async registerVisibleAction(event: WillAppearEvent): Promise<void> {
    const slotIndex = slotIndexFor(event);
    if (slotIndex === undefined) return;
    const action = event.action as KeyAction;
    const priorVisible = this.#visibleActions.get(action.id);
    if (priorVisible !== undefined) this.#cancelVisibleWork(priorVisible);
    const visible: VisibleSessionSlot = { action, slotIndex, renderGeneration: 0, retryGeneration: 0 };
    this.#visibleActions.set(action.id, visible);
    await this.#refreshVisible(visible, this.#state, true, this.options.clock.now());
  }

  unregisterVisibleAction(contextId: string): void {
    const visible = this.#visibleActions.get(contextId);
    if (visible === undefined) return;
    this.#cancelVisibleWork(visible);
    this.#visibleActions.delete(contextId);
  }

  async handleStatusEvent(event: LocalAgentStatusEvent, now: number): Promise<void> {
    const prevState = this.#state;
    this.#state = reduceSessionState(this.#state, { kind: SESSION_REDUCER_ACTION.EVENT, event });
    await this.refresh(now);
    this.#notifyStateChanged(prevState);
  }

  async refresh(now: number): Promise<void> {
    await Promise.all([...this.#visibleActions.values()].map((visible) => this.#refreshVisible(visible, this.#state, false, now)));
  }

  async handlePhysicalKeyDown(contextId: string, now: number): Promise<void> {
    const visible = this.#visibleActions.get(contextId);
    if (visible === undefined) return;
    const slot = this.#state.slots[visible.slotIndex];
    if (slot?.sessionId === undefined || slot.target === undefined) return;
    const sessionId = slot.sessionId;
    const target = slot.target;
    const assignmentId = slot.assignmentId;
    if (assignmentId === undefined) return;
    let outcome: NavigationOutcome;
    try {
      outcome = await (this.options.navigator ?? ghosttyTmuxNavigator).navigate(target);
    } catch {
      this.#logNavigationFailure();
      return;
    }
    if (outcome === NAVIGATION_OUTCOME.UNAVAILABLE) {
      this.#logNavigationFailure();
      return;
    }
    if (!this.#matchesCurrentAssignment(visible.slotIndex, sessionId, target, assignmentId)) return;
    const prevState = this.#state;
    if (outcome === NAVIGATION_OUTCOME.MISSING) {
      this.#state = reduceSessionState(this.#state, {
        kind: SESSION_REDUCER_ACTION.PANE_MISSING,
        slotIndex: visible.slotIndex,
        sessionId,
        target,
        assignmentId,
      });
    } else {
      this.#state = reduceSessionState(this.#state, {
        kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN,
        slotIndex: visible.slotIndex,
        sessionId,
        target,
        assignmentId,
      });
    }
    await this.refresh(now);
    this.#notifyStateChanged(prevState);
  }

  #matchesCurrentAssignment(slotIndex: number, sessionId: string, target: LocalAgentStatusEvent["target"], assignmentId: string): boolean {
    const slot = this.#state.slots[slotIndex];
    return (
      slot?.sessionId === sessionId &&
      slot.assignmentId === assignmentId &&
      slot.target?.tmuxPaneId === target.tmuxPaneId &&
      slot.target.tmuxSession === target.tmuxSession &&
      slot.target.tmuxWindow === target.tmuxWindow &&
      slot.target.ghosttyBundleId === target.ghosttyBundleId
    );
  }

  dispose(): void {
    for (const visible of this.#visibleActions.values()) this.#cancelVisibleWork(visible);
    this.#visibleActions.clear();
  }

  async #refreshVisible(visible: VisibleSessionSlot, state: SessionState, force: boolean, now: number): Promise<void> {
    this.#cancelRetry(visible);
    const generation = visible.renderGeneration + 1;
    visible.renderGeneration = generation;
    const renderResult = await this.#renderVisible(visible, state, force, now, generation);
    if (renderResult === SESSION_SLOT_RENDER_RESULT.FAILED) {
      this.#logRenderFailure();
      this.#scheduleRetry(visible, generation);
    }
  }

  #scheduleRetry(visible: VisibleSessionSlot, renderGeneration: number): void {
    if (this.#visibleActions.get(visible.action.id) !== visible || visible.renderGeneration !== renderGeneration) return;
    this.#cancelRetry(visible);
    const retryGeneration = visible.retryGeneration + 1;
    visible.retryGeneration = retryGeneration;
    visible.retryTimer = this.options.scheduler.schedule(() => {
      if (visible.retryGeneration !== retryGeneration || visible.renderGeneration !== renderGeneration || this.#visibleActions.get(visible.action.id) !== visible) return;
      visible.retryTimer = undefined;
      void this.#retryRender(visible, renderGeneration);
    }, SESSION_SLOT_RENDER_RETRY_DELAY_MS);
  }

  async #retryRender(visible: VisibleSessionSlot, generation: number): Promise<void> {
    const now = this.options.clock.now();
    const renderResult = await this.#renderVisible(visible, this.#state, false, now, generation);
    if (renderResult === SESSION_SLOT_RENDER_RESULT.FAILED) {
      this.#logRenderFailure();
    }
  }

  #cancelRetry(visible: VisibleSessionSlot): void {
    if (visible.retryTimer !== undefined) {
      this.options.scheduler.cancel(visible.retryTimer);
      visible.retryTimer = undefined;
    }
    visible.retryGeneration += 1;
  }

  #cancelVisibleWork(visible: VisibleSessionSlot): void {
    this.#cancelRetry(visible);
  }

  #logRenderFailure(): void {
    try {
      this.options.logger.error(SESSION_SLOT_RENDER_ERROR);
    } catch {
      // Logging must not interfere with local rendering recovery.
    }
  }

  #logNavigationFailure(): void {
    try {
      this.options.logger.error(SESSION_SLOT_NAVIGATION_ERROR);
    } catch {
      // Navigation failures must remain contained even when local logging fails.
    }
  }

  #logPersistenceFailure(): void {
    try {
      this.options.logger.error(SESSION_SLOT_PERSISTENCE_ERROR);
    } catch {
      // Subscriber logging failures must not disrupt the reducer/render loop.
    }
  }

  #notifyStateChanged(prevState: SessionState): void {
    if (this.#state === prevState) return;
    const subscriber = this.#stateSubscriber;
    if (subscriber === undefined) return;
    const snapshot = this.#state;
    Promise.resolve()
      .then(() => subscriber(snapshot))
      .catch(() => this.#logPersistenceFailure());
  }

  async #renderVisible(
    visible: VisibleSessionSlot,
    state: SessionState,
    force: boolean,
    now: number,
    generation: number,
  ): Promise<SessionSlotRenderResult> {
    const color = deriveSlotColor(state.slots[visible.slotIndex], now);
    if (!force && visible.renderedColor === color) return SESSION_SLOT_RENDER_RESULT.SKIPPED;
    try {
      await visible.action.setImage(sessionSlotSvgDataUri(color));
    } catch {
      return SESSION_SLOT_RENDER_RESULT.FAILED;
    }
    if (this.#visibleActions.get(visible.action.id) === visible && visible.renderGeneration === generation) {
      visible.renderedColor = color;
    }
    return SESSION_SLOT_RENDER_RESULT.RENDERED;
  }

}

export const sessionSlotController = new SessionSlotController();
