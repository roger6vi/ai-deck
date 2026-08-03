import { describe, expect, it, vi } from "vitest";

import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import { SESSION_SLOT_COLOR } from "../../src/core/colors";
import { SESSION_STATUS, type LocalAgentStatusEvent, type SessionStatus } from "../../src/core/types";
import {
  SESSION_SLOT_RENDER_ERROR,
  SESSION_SLOT_RENDER_RETRY_DELAY_MS,
  SessionSlotController,
  sessionSlotSvgDataUri,
  type SessionSlotControllerOptions,
} from "../../src/plugin/session-slot-controller";

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
  readonly logger: { error: ReturnType<typeof vi.fn<(message: string) => void>> };
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
    logger: { error: vi.fn<(message: string) => void>() },
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
  it("logs the fixed generic error and schedules one bounded retry after a direct render failure", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    action.setImage.mockRejectedValueOnce(new Error("raw render failure"));

    await subject.registerVisibleAction(appear(action));

    expect(testFixture.logger.error).toHaveBeenCalledExactlyOnceWith(SESSION_SLOT_RENDER_ERROR);
    expect(testFixture.timers).toHaveLength(1);
    expect(testFixture.timers[0]?.deadline).toBe(SESSION_SLOT_RENDER_RETRY_DELAY_MS);
    expect(testFixture.activeTimerCount()).toBe(1);
  });

  it("uses the current clock on retry, renders the current color, and schedules no further work", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    action.setImage.mockRejectedValueOnce(new Error("offline"));

    testFixture.setNow(1);
    await subject.handleStatusEvent(status(), 1);
    testFixture.setNow(1 + SESSION_SLOT_RENDER_RETRY_DELAY_MS);
    testFixture.runDue();
    await settle();

    expect(lastImage(action)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("logs a generic second failure and stops the retry without an unhandled rejection", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    action.setImage.mockRejectedValueOnce(new Error("first failure")).mockRejectedValueOnce(new Error("second failure"));

    try {
      await subject.registerVisibleAction(appear(action));
      testFixture.setNow(SESSION_SLOT_RENDER_RETRY_DELAY_MS);
      testFixture.runDue();
      await settle();

      expect(testFixture.logger.error).toHaveBeenCalledTimes(2);
      expect(testFixture.logger.error).toHaveBeenNthCalledWith(1, SESSION_SLOT_RENDER_ERROR);
      expect(testFixture.logger.error).toHaveBeenNthCalledWith(2, SESSION_SLOT_RENDER_ERROR);
      expect(testFixture.activeTimerCount()).toBe(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("cancels an amber retry when state rolls back to an already-rendered green slot", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    action.setImage.mockRejectedValueOnce(new Error("amber failure"));

    await subject.handleStatusEvent(status(), 1);
    const staleRetry = testFixture.timers.at(-1);
    if (staleRetry === undefined) throw new Error("Expected a queued retry.");
    await subject.handleStatusEvent(status(SESSION_STATUS.PANE_DISAPPEARED, 2), 2);
    staleRetry.callback();
    await settle();

    expect(staleRetry.cancelled).toBe(true);
    expect(action.setImage).toHaveBeenCalledTimes(2);
    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("cancels a retry for newer rendering, duplicate contexts, unregistration, and disposal", async () => {
    const cleanupCases: ReadonlyArray<(subject: SessionSlotController, action: MockKey) => Promise<void> | void> = [
      (subject) => subject.refresh(0),
      (subject, action) => subject.registerVisibleAction(appear(action)),
      (subject, action) => subject.unregisterVisibleAction(action.id),
      (subject) => subject.dispose(),
    ];

    for (const cleanup of cleanupCases) {
      const testFixture = fixture();
      const subject = controller(testFixture);
      const action = key("first");
      action.setImage.mockRejectedValueOnce(new Error("retry cancellation"));
      await subject.registerVisibleAction(appear(action));
      const staleRetry = testFixture.timers.at(-1);
      if (staleRetry === undefined) throw new Error("Expected a queued retry.");

      await cleanup(subject, action);
      staleRetry.callback();
      await settle();

      expect(staleRetry.cancelled).toBe(true);
      expect(testFixture.activeTimerCount()).toBe(0);
    }
  });

  it("keeps retry work independent per visible context", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const first = key("first", 0);
    const second = key("second", 1);
    testFixture.setNow(2);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, 1), 1);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, 2, "223e4567-e89b-42d3-a456-426614174000"), 2);
    first.setImage.mockRejectedValueOnce(new Error("first retry"));
    second.setImage.mockRejectedValueOnce(new Error("second retry"));

    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));
    expect(testFixture.activeTimerCount()).toBe(2);
    testFixture.setNow(2 + SESSION_SLOT_RENDER_RETRY_DELAY_MS);
    testFixture.runDue();
    await settle();

    expect(first.setImage).toHaveBeenCalledTimes(2);
    expect(second.setImage).toHaveBeenCalledTimes(2);
    expect(testFixture.activeTimerCount()).toBe(0);
  });

  it("never passes render content to the logger and contains a throwing logger", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("private-context");
    const sentinel = "RAW_SENTINEL private-context #ff0000 data:image/svg+xml,%3Csvg%3E %123";
    action.setImage.mockRejectedValueOnce(new Error(sentinel));
    testFixture.logger.error.mockImplementation(() => { throw new Error("logger failure"); });

    await subject.registerVisibleAction(appear(action));

    expect(testFixture.logger.error).toHaveBeenCalledExactlyOnceWith(SESSION_SLOT_RENDER_ERROR);
    expect(testFixture.logger.error.mock.calls.flat().join(" ")).not.toContain(sentinel);
    expect(testFixture.activeTimerCount()).toBe(1);
  });

  it("renders running slots amber once, schedules no timers, and keeps amber at any later time", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const action = key("first");
    await subject.registerVisibleAction(appear(action));
    await subject.handleStatusEvent(status(), 1);

    expect(lastImage(action)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(testFixture.activeTimerCount()).toBe(0);

    testFixture.setNow(Number.MAX_SAFE_INTEGER);
    testFixture.runDue();
    await settle();
    expect(lastImage(action)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(testFixture.activeTimerCount()).toBe(0);

    const lateFixture = fixture();
    const lateSubject = controller(lateFixture);
    const lateAction = key("late");
    await lateSubject.registerVisibleAction(appear(lateAction));
    lateFixture.setNow(1);
    await lateSubject.handleStatusEvent(status(), 1);
    lateFixture.setNow(Number.MAX_SAFE_INTEGER);
    await lateSubject.refresh(lateFixture.clock.now());
    expect(lastImage(lateAction)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(lateFixture.activeTimerCount()).toBe(0);
  });

  it("never schedules timers across lifecycle, pane, context, and disposal changes", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture);
    const first = key("first", 0);
    const second = key("second", 1);
    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));
    testFixture.setNow(1);
    await subject.handleStatusEvent(status(), 1);
    testFixture.setNow(2);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, 2, "223e4567-e89b-42d3-a456-426614174000"), 2);
    expect(testFixture.activeTimerCount()).toBe(0);

    testFixture.setNow(3);
    await subject.handleStatusEvent(status(SESSION_STATUS.RUNNING, 3), 3);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    const later = 1 + 10 * 60 * 1000;
    testFixture.setNow(later);
    await subject.handleStatusEvent(status(SESSION_STATUS.COMPLETED, later), later);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.BLUE));
    testFixture.setNow(later + 1);
    await subject.handleStatusEvent(status(SESSION_STATUS.PANE_DISAPPEARED, later + 1, "223e4567-e89b-42d3-a456-426614174000"), later + 1);
    expect(testFixture.activeTimerCount()).toBe(0);

    testFixture.setNow(later + 2);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, later + 2), later + 2);
    testFixture.setNow(later + 3);
    await subject.handleStatusEvent(status(SESSION_STATUS.ERROR, later + 3), later + 3);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.RED));
    expect(testFixture.activeTimerCount()).toBe(0);
    testFixture.setNow(later + 4);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, later + 4), later + 4);
    testFixture.setNow(later + 5);
    await subject.handleStatusEvent(status(SESSION_STATUS.COMPLETED, later + 5), later + 5);
    await subject.handlePhysicalKeyDown(first.id, later + 6);
    expect(testFixture.activeTimerCount()).toBe(0);
    testFixture.setNow(later + 7);
    await subject.handleStatusEvent(status(SESSION_STATUS.STARTED, later + 7), later + 7);
    subject.unregisterVisibleAction(first.id);
    expect(testFixture.activeTimerCount()).toBe(0);
    await subject.registerVisibleAction(appear(first));
    subject.dispose();
    expect(testFixture.activeTimerCount()).toBe(0);
    expect(subject.visibleContextCount).toBe(0);
  });

  it("does not let an older deferred render schedule any work after a newer pane refresh", async () => {
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
});
