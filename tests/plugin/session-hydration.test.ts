import { describe, expect, it, vi } from "vitest";

import {
  SESSION_REDUCER_ACTION,
  createSessionState,
  reduceSessionState,
  type SessionState,
} from "../../src/core/reducer";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";
import { SessionSlotController } from "../../src/plugin/session-slot-controller";

const CLOCK = { now: () => 0 };
const SCHEDULER = { schedule: () => 0, cancel: () => undefined };
const LOGGER = { error: () => undefined };

function baseEvent(overrides: Partial<LocalAgentStatusEvent> = {}): LocalAgentStatusEvent {
  return {
    schemaVersion: 1,
    eventId: overrides.eventId ?? "00000000-0000-4000-8000-00000000abcd",
    source: overrides.source ?? "codex",
    sessionId: overrides.sessionId ?? "00000000-0000-4000-8000-00000000f001",
    timestamp: overrides.timestamp ?? 1_000,
    lifecycle: overrides.lifecycle ?? SESSION_STATUS.STARTED,
    target: overrides.target ?? {
      tmuxPaneId: "%1",
      tmuxSession: "$0",
      ghosttyBundleId: "com.mitchellh.ghostty",
    },
    ...(overrides.sequence === undefined ? {} : { sequence: overrides.sequence }),
  };
}

function stateWithSession(): SessionState {
  return reduceSessionState(createSessionState(), {
    kind: SESSION_REDUCER_ACTION.EVENT,
    event: baseEvent(),
  });
}

describe("session slot controller hydration", () => {
  it("hydrateState replaces the internal state and exposes it via .state", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const hydrated = stateWithSession();
    await controller.hydrateState(hydrated);
    expect(controller.state).toBe(hydrated);
  });

  it("state subscribers receive updates after handleStatusEvent changes state", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const seen: SessionState[] = [];
    controller.subscribeToStateChanges((state) => { seen.push(state); });

    await controller.handleStatusEvent(baseEvent(), 0);
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.slots[0]?.sessionId).toBe("00000000-0000-4000-8000-00000000f001");
  });

  it("state subscribers do not fire when reduceSessionState returns the same state", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const event = baseEvent();
    await controller.handleStatusEvent(event, 0);
    const seen: SessionState[] = [];
    controller.subscribeToStateChanges((state) => { seen.push(state); });

    await controller.handleStatusEvent(event, 0);
    await Promise.resolve();

    expect(seen).toHaveLength(0);
  });

  it("state subscribers do not fire after hydrateState (hydration is a source, not a reducer output)", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const seen: SessionState[] = [];
    controller.subscribeToStateChanges((state) => { seen.push(state); });

    await controller.hydrateState(stateWithSession());
    await Promise.resolve();

    expect(seen).toHaveLength(0);
  });

  it("returns an unsubscribe function that stops further notifications", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const seen: SessionState[] = [];
    const unsubscribe = controller.subscribeToStateChanges((state) => { seen.push(state); });

    await controller.handleStatusEvent(baseEvent(), 0);
    await Promise.resolve();
    expect(seen).toHaveLength(1);

    unsubscribe();

    await controller.handleStatusEvent(baseEvent({
      eventId: "00000000-0000-4000-8000-00000000abce",
      sessionId: "00000000-0000-4000-8000-00000000f002",
      target: { tmuxPaneId: "%2", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
    }), 0);
    await Promise.resolve();
    expect(seen).toHaveLength(1);
  });

  it("subscriber rejections are contained and logged, not propagated", async () => {
    const errors: string[] = [];
    const controller = new SessionSlotController({
      clock: CLOCK,
      scheduler: SCHEDULER,
      logger: { error: (message) => errors.push(message) },
    });
    controller.subscribeToStateChanges(() => { throw new Error("persistence exploded"); });

    await controller.handleStatusEvent(baseEvent(), 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).not.toContain("exploded");
  });

  it("only the most recently registered subscriber receives notifications", async () => {
    const controller = new SessionSlotController({ clock: CLOCK, scheduler: SCHEDULER, logger: LOGGER });
    const first = vi.fn();
    const second = vi.fn();
    controller.subscribeToStateChanges(first);
    controller.subscribeToStateChanges(second);

    await controller.handleStatusEvent(baseEvent(), 0);
    await Promise.resolve();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
