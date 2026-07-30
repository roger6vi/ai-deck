import { describe, expect, it, vi } from "vitest";

import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import { SESSION_COLOR_LIMITS, SESSION_SLOT_COLOR } from "../../src/core/colors";
import { SESSION_STATUS, type LocalAgentStatusEvent, type SessionStatus } from "../../src/core/types";
import { SessionSlotController, type SessionSlotControllerOptions } from "../../src/plugin/session-slot-controller";

interface MockKey {
  readonly id: string;
  readonly coordinates: { readonly column: number; readonly row: number };
  readonly setImage: ReturnType<typeof vi.fn<(image?: string) => Promise<void>>>;
}

interface Timer {
  readonly deadline: number;
  readonly callback: () => void;
  cancelled: boolean;
}

interface Fixture {
  readonly clock: { now: () => number };
  readonly scheduler: { schedule: (callback: () => void, delayMs: number) => Timer; cancel: (timer: Timer) => void };
  readonly timers: Timer[];
  setNow(now: number): void;
  runDue(): void;
  activeTimerCount(): number;
}

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

function fixture(): Fixture {
  let now = 0;
  const timers: Timer[] = [];
  return {
    clock: { now: () => now },
    scheduler: {
      schedule: (callback, delayMs) => {
        const timer = { deadline: now + delayMs, callback, cancelled: false };
        timers.push(timer);
        return timer;
      },
      cancel: (timer) => { timer.cancelled = true; },
    },
    timers,
    setNow: (value) => { now = value; },
    runDue: () => timers.filter((timer) => !timer.cancelled && timer.deadline <= now).forEach((timer) => {
      timer.cancelled = true;
      timer.callback();
    }),
    activeTimerCount: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

function controller(testFixture: Fixture): SessionSlotController {
  const options: SessionSlotControllerOptions = testFixture;
  return new SessionSlotController(options);
}

function key(id: string, column = 0): MockKey {
  return {
    id,
    coordinates: { column, row: 0 },
    setImage: vi.fn<(image?: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}

function appear(action: MockKey): WillAppearEvent {
  return {
    action: action as unknown as KeyAction,
    payload: { controller: "Keypad", isInMultiAction: false, coordinates: action.coordinates, resources: {}, settings: {} },
  } as unknown as WillAppearEvent;
}

function status(lifecycle: SessionStatus = SESSION_STATUS.STARTED, timestamp = 1, sessionId = SESSION_ID): LocalAgentStatusEvent {
  return {
    schemaVersion: 1,
    eventId: `de305d54-75b4-431b-adb2-eb6b9e5460${timestamp.toString().padStart(2, "0")}`,
    source: "opencode",
    sessionId,
    sequence: timestamp,
    timestamp,
    lifecycle,
    target: { tmuxPaneId: `%${timestamp}`, tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function lastImage(action: MockKey): string | undefined {
  return action.setImage.mock.calls.at(-1)?.[0];
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface DeferredRender {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferredRender(): DeferredRender {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("session slot production render scheduling", () => {
  it("schedules amber once, remains amber before the deadline, and renders red at the exact boundary", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    await subject.handleStatusEvent(status(), 1);

    expect(testFixture.activeTimerCount()).toBe(1);
    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS - 1);
    testFixture.runDue();
    await settle();
    expect(lastImage(action)).toContain(SESSION_SLOT_COLOR.AMBER);

    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS);
    testFixture.runDue();
    await settle();
    expect(lastImage(action)).toContain(SESSION_SLOT_COLOR.RED);
    expect(testFixture.activeTimerCount()).toBe(0);

    const lateFixture = fixture();
    const lateSubject = controller(lateFixture);
    const lateAction = key("late");
    await lateSubject.registerVisibleAction(appear(lateAction));
    lateFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS + 1);
    await lateSubject.handleStatusEvent(status(), lateFixture.clock.now());
    lateFixture.runDue();
    await settle();
    expect(lastImage(lateAction)).toContain(SESSION_SLOT_COLOR.RED);
    expect(lateFixture.activeTimerCount()).toBe(0);
  });

  it("reschedules independent slots and cancels advisory work for lifecycle, pane, context, and disposal changes", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const first = key("first", 0);
    const second = key("second", 1);
    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));
    testFixture.setNow(1);
    await subject.handleStatusEvent(status(), 1);
    const staleAdvisory = testFixture.timers[0];
    if (staleAdvisory === undefined) throw new Error("Expected a queued advisory.");
    testFixture.setNow(2);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, 2, "223e4567-e89b-42d3-a456-426614174000"), 2);
    expect(testFixture.activeTimerCount()).toBe(2);

    testFixture.setNow(3);
    await subject.handleStatusEvent(status(SESSION_STATUS.RUNNING, 3), 3);
    expect(testFixture.activeTimerCount()).toBe(2);
    expect(testFixture.timers.filter((timer) => timer.cancelled)).toHaveLength(3);
    staleAdvisory.callback();
    await settle();
    expect(testFixture.activeTimerCount()).toBe(2);
    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS - 1);
    testFixture.runDue();
    await settle();
    expect(lastImage(first)).toContain(SESSION_SLOT_COLOR.AMBER);
    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS);
    testFixture.runDue();
    await settle();
    expect(lastImage(first)).toContain(SESSION_SLOT_COLOR.RED);
    const afterBoundary = 1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS;
    testFixture.setNow(afterBoundary);
    await subject.handleStatusEvent(status(SESSION_STATUS.COMPLETED, afterBoundary), afterBoundary);
    expect(testFixture.activeTimerCount()).toBe(1);
    testFixture.setNow(afterBoundary + 1);
    await subject.handleStatusEvent(status(SESSION_STATUS.PANE_DISAPPEARED, afterBoundary + 1, "223e4567-e89b-42d3-a456-426614174000"), afterBoundary + 1);
    expect(testFixture.activeTimerCount()).toBe(0);

    testFixture.setNow(afterBoundary + 2);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, afterBoundary + 2), afterBoundary + 2);
    testFixture.setNow(afterBoundary + 3);
    await subject.handleStatusEvent(status(SESSION_STATUS.ERROR, afterBoundary + 3), afterBoundary + 3);
    expect(testFixture.activeTimerCount()).toBe(0);
    testFixture.setNow(afterBoundary + 4);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, afterBoundary + 4), afterBoundary + 4);
    testFixture.setNow(afterBoundary + 5);
    await subject.handleStatusEvent(status(SESSION_STATUS.COMPLETED, afterBoundary + 5), afterBoundary + 5);
    await subject.handlePhysicalKeyDown(first.id, afterBoundary + 6);
    expect(testFixture.activeTimerCount()).toBe(0);
    testFixture.setNow(afterBoundary + 7);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, afterBoundary + 7), afterBoundary + 7);
    subject.unregisterVisibleAction(first.id);
    expect(testFixture.activeTimerCount()).toBe(0);
    await subject.registerVisibleAction(appear(first));
    subject.dispose();
    expect(testFixture.activeTimerCount()).toBe(0);
    expect(subject.visibleContextCount).toBe(0);
  });

  it("does not let an older deferred render schedule an advisory after a newer pane refresh", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    const pendingAmber = deferredRender();
    action.setImage.mockImplementationOnce(() => pendingAmber.promise);

    const olderRefresh = subject.handleStatusEvent(status(), 1);
    await subject.handleStatusEvent(status(SESSION_STATUS.PANE_DISAPPEARED, 2), 2);
    pendingAmber.resolve();
    await olderRefresh;

    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("queues one immediate refresh when an amber render crosses its advisory deadline", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    const pendingAmber = deferredRender();
    action.setImage.mockImplementationOnce(() => pendingAmber.promise);

    testFixture.setNow(1);
    const refresh = subject.handleStatusEvent(status(), 1);
    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS + 1);
    pendingAmber.resolve();
    await refresh;

    expect(testFixture.activeTimerCount()).toBe(1);
    testFixture.runDue();
    await settle();
    expect(lastImage(action)).toContain(SESSION_SLOT_COLOR.RED);
    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("stops after the immediate red render fails", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    const pendingAmber = deferredRender();
    action.setImage.mockImplementationOnce(() => pendingAmber.promise).mockRejectedValueOnce(new Error("offline"));

    testFixture.setNow(1);
    const refresh = subject.handleStatusEvent(status(), 1);
    testFixture.setNow(1 + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS + 1);
    pendingAmber.resolve();
    await refresh;
    testFixture.runDue();
    await settle();

    expect(action.setImage).toHaveBeenCalledTimes(3);
    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("replaces a duplicate context without retaining its obsolete advisory timer", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    await subject.handleStatusEvent(status(), 1);
    const obsoleteTimer = testFixture.timers.at(-1);
    if (obsoleteTimer === undefined) throw new Error("Expected an advisory timer.");

    await subject.registerVisibleAction(appear(action));

    expect(obsoleteTimer.cancelled).toBe(true);
    expect(testFixture.activeTimerCount()).toBe(1);
    subject.dispose();
    expect(testFixture.activeTimerCount()).toBe(0);
  });
});
