import { describe, expect, it } from "vitest";

import {
  SESSION_REDUCER_ACTION,
  SESSION_REDUCER_LIMITS,
  SESSION_SLOT_COLOR,
  createSessionState,
  deriveSlotColor,
  reduceSessionState,
} from "../../src/core/reducer";
import {
  LOCAL_AGENT_TOOL,
  SESSION_STATUS,
  type LocalAgentStatusEvent,
} from "../../src/core/types";

const FIVE_MINUTES = 5 * 60 * 1000;
const SLOT_COUNT = SESSION_REDUCER_LIMITS.SLOT_COUNT;
const RETIRED_HISTORY_LIMIT = SESSION_REDUCER_LIMITS.RETIRED_SESSION_LIMIT;
const SESSION_IDS = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
  "323e4567-e89b-42d3-a456-426614174000",
  "423e4567-e89b-42d3-a456-426614174000",
  "523e4567-e89b-42d3-a456-426614174000",
  "623e4567-e89b-42d3-a456-426614174000",
] as const;

interface EventOptions {
  readonly eventNumber?: number;
  readonly lifecycle?: typeof SESSION_STATUS[keyof typeof SESSION_STATUS];
  readonly sequence?: number;
  readonly sessionId?: string;
  readonly timestamp?: number;
  readonly tmuxPaneId?: string;
}

function event(options: EventOptions = {}): LocalAgentStatusEvent {
  const eventNumber = options.eventNumber ?? 1;
  return {
    schemaVersion: 1,
    eventId: `de305d54-75b4-431b-adb2-eb6b9e5460${eventNumber.toString().padStart(2, "0")}`,
    source: LOCAL_AGENT_TOOL.OPENCODE,
    sessionId: options.sessionId ?? SESSION_IDS[0],
    sequence: options.sequence ?? eventNumber,
    timestamp: options.timestamp ?? eventNumber,
    lifecycle: options.lifecycle ?? SESSION_STATUS.STARTED,
    target: {
      tmuxPaneId: options.tmuxPaneId ?? `%${eventNumber}`,
      tmuxSession: "$0",
      ghosttyBundleId: "com.mitchellh.ghostty",
    },
  };
}

function apply(state: ReturnType<typeof createSessionState>, statusEvent: LocalAgentStatusEvent) {
  return reduceSessionState(state, { kind: SESSION_REDUCER_ACTION.EVENT, event: statusEvent });
}

function assignedIds(state: ReturnType<typeof createSessionState>) {
  return state.slots.map((slot) => slot.sessionId);
}

describe("session status reducer", () => {
  it("assigns first-free slots, keeps assignments stable, rejects a sixth session, and reuses released slots", () => {
    let state = createSessionState();
    state = apply(state, event({ sessionId: SESSION_IDS[0] }));
    state = apply(state, event({ eventNumber: 2, sessionId: SESSION_IDS[1] }));
    const stable = apply(apply(state, event({ eventNumber: 3, lifecycle: SESSION_STATUS.RUNNING })), event({ eventNumber: 4, lifecycle: SESSION_STATUS.COMPLETED }));
    expect(assignedIds(stable)).toEqual([SESSION_IDS[0], SESSION_IDS[1], undefined, undefined, undefined]);
    expect(stable.slots.slice(1)).toEqual(state.slots.slice(1));
    state = stable;
    for (const [index, sessionId] of SESSION_IDS.slice(2, SLOT_COUNT).entries()) {
      state = apply(state, event({ eventNumber: index + 5, sessionId }));
    }

    expect(assignedIds(state)).toEqual([...SESSION_IDS.slice(0, SLOT_COUNT)]);
    expect(state.slots[0]?.target?.tmuxPaneId).toBe("%4");
    expect(state.slots[1]?.target?.tmuxPaneId).toBe("%2");

    const full = apply(state, event({ eventNumber: 7, sessionId: SESSION_IDS[5] }));
    expect(full).toBe(state);

    const released = apply(
      full,
      event({ eventNumber: 8, lifecycle: SESSION_STATUS.PANE_DISAPPEARED, sessionId: SESSION_IDS[0] }),
    );
    const reused = apply(released, event({ eventNumber: 9, sessionId: SESSION_IDS[5] }));
    expect(assignedIds(reused)).toEqual([SESSION_IDS[5], ...SESSION_IDS.slice(1, 5)]);
  });

  it("derives free, running, overdue, completed, error, and acknowledged colors at the exact boundary", () => {
    let state = apply(createSessionState(), event({ timestamp: 0 }));
    const runningSlot = state.slots[0];
    expect(deriveSlotColor(state.slots[1], 0)).toBe(SESSION_SLOT_COLOR.GRAY);
    expect(deriveSlotColor(runningSlot, FIVE_MINUTES - 1)).toBe(SESSION_SLOT_COLOR.AMBER);
    expect(deriveSlotColor(runningSlot, FIVE_MINUTES)).toBe(SESSION_SLOT_COLOR.RED);
    expect(runningSlot?.lifecycle).toBe(SESSION_STATUS.STARTED);

    state = apply(state, event({ eventNumber: 2, lifecycle: SESSION_STATUS.COMPLETED, timestamp: 1 }));
    expect(deriveSlotColor(state.slots[0], 1)).toBe(SESSION_SLOT_COLOR.BLUE);

    state = reduceSessionState(state, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: 0 });
    expect(deriveSlotColor(state.slots[0], 1)).toBe(SESSION_SLOT_COLOR.GREEN);

    state = apply(state, event({ eventNumber: 3, lifecycle: SESSION_STATUS.ERROR, timestamp: 2 }));
    expect(deriveSlotColor(state.slots[0], 2)).toBe(SESSION_SLOT_COLOR.RED);
  });

  it("acknowledges only assigned blue slots and makes all other physical presses no-ops", () => {
    const running = apply(createSessionState(), event());
    const ignored = reduceSessionState(running, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: 0 });
    expect(ignored).toBe(running);

    const completed = apply(running, event({ eventNumber: 2, lifecycle: SESSION_STATUS.COMPLETED }));
    const wrongSlot = reduceSessionState(completed, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: 1 });
    expect(wrongSlot).toBe(completed);

    const acknowledged = reduceSessionState(completed, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: 0 });
    const repeated = reduceSessionState(acknowledged, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: 0 });
    expect(repeated).toBe(acknowledged);
    for (const invalidIndex of [-1, SLOT_COUNT, 0.5]) {
      expect(reduceSessionState(acknowledged, { kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN, slotIndex: invalidIndex })).toBe(acknowledged);
    }
    expect(deriveSlotColor(repeated.slots[0], 2)).toBe(SESSION_SLOT_COLOR.GREEN);
  });

  it("ignores duplicate, stale, and out-of-order events without affecting other sessions", () => {
    const started = apply(createSessionState(), event({ eventNumber: 1, sessionId: SESSION_IDS[0], timestamp: 10, sequence: 1 }));
    const running = apply(started, event({ eventNumber: 2, lifecycle: SESSION_STATUS.RUNNING, timestamp: 20, sequence: 2 }));
    const duplicate = apply(running, event({ eventNumber: 2, lifecycle: SESSION_STATUS.RUNNING, timestamp: 20, sequence: 2 }));
    const stale = apply(running, event({ eventNumber: 3, lifecycle: SESSION_STATUS.COMPLETED, timestamp: 19, sequence: 3 }));
    const outOfOrder = apply(running, event({ eventNumber: 4, lifecycle: SESSION_STATUS.ERROR, timestamp: 20, sequence: 1 }));

    expect(duplicate).toBe(running);
    expect(stale).toBe(running);
    expect(outOfOrder).toBe(running);

    const independent = apply(running, event({ eventNumber: 5, sessionId: SESSION_IDS[1], timestamp: 11 }));
    expect(assignedIds(independent)).toEqual([SESSION_IDS[0], SESSION_IDS[1], undefined, undefined, undefined]);
    expect(deriveSlotColor(independent.slots[0], 20)).toBe(SESSION_SLOT_COLOR.AMBER);
    expect(deriveSlotColor(independent.slots[1], 11)).toBe(SESSION_SLOT_COLOR.AMBER);
  });

  it("releases disappeared panes, ignores late events, and permits a newer started lifecycle", () => {
    const started = apply(createSessionState(), event({ timestamp: 10, sequence: 1 }));
    const disappeared = apply(started, event({ eventNumber: 2, lifecycle: SESSION_STATUS.PANE_DISAPPEARED, timestamp: 20, sequence: 2 }));
    const late = apply(disappeared, event({ eventNumber: 3, lifecycle: SESSION_STATUS.RUNNING, timestamp: 19, sequence: 3 }));
    const restarted = apply(late, event({ eventNumber: 4, lifecycle: SESSION_STATUS.STARTED, timestamp: 21, sequence: 3 }));

    expect(assignedIds(disappeared)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(late).toBe(disappeared);
    expect(assignedIds(restarted)).toEqual([SESSION_IDS[0], undefined, undefined, undefined, undefined]);
    expect(deriveSlotColor(restarted.slots[0], 21)).toBe(SESSION_SLOT_COLOR.AMBER);
  });

  it("distinguishes a restarted same-value assignment from its delayed missing-pane result", () => {
    const assigned = apply(createSessionState(), event({ eventNumber: 1, tmuxPaneId: "%1" }));
    const released = apply(assigned, event({ eventNumber: 2, lifecycle: SESSION_STATUS.PANE_DISAPPEARED, tmuxPaneId: "%1" }));
    const restarted = apply(released, event({ eventNumber: 3, lifecycle: SESSION_STATUS.STARTED, tmuxPaneId: "%1" }));
    const original = assigned.slots[0];
    const current = restarted.slots[0];
    if (original?.target === undefined || current?.target === undefined) throw new Error("Expected assigned targets.");
    const delayed = reduceSessionState(restarted, {
      kind: SESSION_REDUCER_ACTION.PANE_MISSING,
      slotIndex: 0,
      sessionId: SESSION_IDS[0],
      target: original.target,
      assignmentId: original.assignmentId ?? "",
    });
    const missing = reduceSessionState(restarted, {
      kind: SESSION_REDUCER_ACTION.PANE_MISSING,
      slotIndex: 0,
      sessionId: SESSION_IDS[0],
      target: current.target,
      assignmentId: current.assignmentId ?? "",
    });
    expect(delayed).toBe(restarted);
    expect(missing.slots[0]?.sessionId).toBeUndefined();
    expect(deriveSlotColor(missing.slots[0], 3)).toBe(SESSION_SLOT_COLOR.GRAY);
  });

  it("returns frozen isolated state without retaining references or work content", () => {
    const rawTarget = { tmuxPaneId: "%1", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" };
    const untrustedEvent = Object.assign(event(), { target: rawTarget, prompt: "confidential work" });
    const initial = createSessionState();
    const result = apply(initial, untrustedEvent);
    rawTarget.tmuxPaneId = "%99";

    expect(initial.slots[0]).toEqual({ index: 0 });
    expect(result.slots[0]?.target?.tmuxPaneId).toBe("%1");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.slots)).toBe(true);
    expect(Object.isFrozen(result.slots[0])).toBe(true);
    expect(Object.isFrozen(result.slots[0]?.target)).toBe(true);
    expect(result.slots[0]?.target).not.toBe(rawTarget);
    expect(JSON.stringify(result)).not.toContain("confidential work");
  });

  it("keeps retired-session dedupe tracking bounded and deterministic", () => {
    let state = createSessionState();
    for (let index = 0; index < RETIRED_HISTORY_LIMIT + 1; index += 1) {
      const sessionId = `123e4567-e89b-42d3-a456-${index.toString().padStart(12, "0")}`;
      state = apply(state, event({ eventNumber: index * 2 + 1, sessionId, timestamp: index * 2 + 1 }));
      state = apply(state, event({ eventNumber: index * 2 + 2, sessionId, lifecycle: SESSION_STATUS.PANE_DISAPPEARED, timestamp: index * 2 + 2 }));
    }

    expect(state.retiredSessions).toHaveLength(RETIRED_HISTORY_LIMIT);
    expect(Object.isFrozen(state.retiredSessions[0])).toBe(true);
    expect(state.retiredSessions[0]?.sessionId).toBe("123e4567-e89b-42d3-a456-000000000001");
    expect(state.retiredSessions[RETIRED_HISTORY_LIMIT - 1]?.sessionId).toBe(`123e4567-e89b-42d3-a456-${RETIRED_HISTORY_LIMIT.toString().padStart(12, "0")}`);
  });

  it("produces the same frozen result for the same input and event", () => {
    const initial = createSessionState();
    const statusEvent = event({ timestamp: 123, sequence: 4 });
    const first = apply(initial, statusEvent);
    const second = apply(initial, statusEvent);

    expect(first).toEqual(second);
    expect(deriveSlotColor(first.slots[0], 123 + FIVE_MINUTES)).toBe(SESSION_SLOT_COLOR.RED);
  });
});
