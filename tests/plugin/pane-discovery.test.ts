import { describe, expect, it, vi } from "vitest";

import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import { SESSION_SLOT_COLOR } from "../../src/core/colors";
import { SESSION_STATUS, type SessionStatus } from "../../src/core/types";
import type { SessionState } from "../../src/core/reducer";
import {
  PANE_DISCOVERY_INTERVAL_MS,
  type DiscoveredPane,
  type TmuxPaneDiscovery,
} from "../../src/persistence/pane-discovery";
import {
  CLEAR_SLOT_EVENT,
  SessionSlotController,
  sessionSlotSvgDataUri,
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
  readonly logger: { error: ReturnType<typeof vi.fn<(message: string) => void>>; info: ReturnType<typeof vi.fn<(message: string) => void>> };
  readonly timers: Timer[];
  setNow(now: number): void;
  runDue(): void;
  activeTimerCount(): number;
}

const TOOL_SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_TOOL_SESSION_ID = "223e4567-e89b-42d3-a456-426614174000";

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
    logger: { error: vi.fn<(message: string) => void>(), info: vi.fn<(message: string) => void>() },
    timers,
    setNow: (value) => { now = value; },
    runDue: () => timers.filter((timer) => !timer.cancelled && timer.deadline <= now).forEach((timer) => {
      timer.cancelled = true;
      timer.callback();
    }),
    activeTimerCount: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

function controller(testFixture: Fixture, paneDiscovery?: TmuxPaneDiscovery): SessionSlotController {
  return new SessionSlotController({ ...testFixture, ...(paneDiscovery === undefined ? {} : { paneDiscovery }) });
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

/** Deterministic descriptor shape: a pane id plus a stable placeholder identity. */
function discovered(paneId: string, number: number, tmuxSession = "$0", tmuxWindow = `@${number}`): DiscoveredPane {
  return {
    sessionId: `00000000-0000-4000-8000-00000000d0${number.toString().padStart(2, "0")}`,
    target: { tmuxPaneId: paneId, tmuxSession, tmuxWindow, ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function toolEvent(lifecycle: SessionStatus, paneId: string, sessionId = TOOL_SESSION_ID, timestamp = 1) {
  return {
    schemaVersion: 1,
    eventId: `de305d54-75b4-431b-adb2-eb6b9e5460${timestamp.toString().padStart(2, "0")}`,
    source: "claude",
    sessionId,
    timestamp,
    lifecycle,
    target: { tmuxPaneId: paneId, tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  } as const;
}

function lastImage(action: MockKey): string | undefined {
  return action.setImage.mock.calls.at(-1)?.[0];
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("session slot baseline pane discovery", () => {
  it("shows freshly discovered live panes as idle green placeholders without fabricating agent events", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>().mockResolvedValue([discovered("%0", 0), discovered("%6", 6)]);
    const subject = controller(testFixture, { discover });
    const saved: SessionState[] = [];
    subject.subscribeToStateChanges(async (state) => { saved.push(state); });
    const first = key("first", 0);
    const second = key("second", 1);
    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));

    await subject.startPaneDiscovery();
    await settle();

    expect(discover).toHaveBeenCalledTimes(1);
    expect(subject.state.slots[0]).toMatchObject({
      sessionId: "00000000-0000-4000-8000-00000000d000",
      source: "tmux",
      lifecycle: SESSION_STATUS.IDLE,
      target: { tmuxPaneId: "%0", tmuxSession: "$0", tmuxWindow: "@0" },
    });
    expect(subject.state.slots[1]?.target?.tmuxPaneId).toBe("%6");
    // Presence is not a lifecycle claim: nothing that looks like an event is stored.
    expect(subject.state.slots[0]?.lastEventId).toBeUndefined();
    expect(subject.state.slots[0]?.lastTimestamp).toBeUndefined();
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    expect(lastImage(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    // The snapshot reaches the persistence subscriber so it survives a restart.
    expect(saved).toHaveLength(1);
    expect(saved[0]?.slots[0]?.source).toBe("tmux");
  });

  it("adds a new pane and drops a vanished one on later bounded polls", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>()
      .mockResolvedValueOnce([discovered("%0", 0), discovered("%6", 6)])
      .mockResolvedValue([discovered("%0", 0), discovered("%7", 7)]);
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    const second = key("second", 1);
    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));

    await subject.startPaneDiscovery();
    expect(subject.state.slots[1]?.target?.tmuxPaneId).toBe("%6");
    expect(testFixture.activeTimerCount()).toBe(1);
    expect(testFixture.timers.at(-1)?.deadline).toBe(PANE_DISCOVERY_INTERVAL_MS);

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS);
    testFixture.runDue();
    await settle();

    expect(discover).toHaveBeenCalledTimes(2);
    expect(subject.state.slots.map((slot) => slot.target?.tmuxPaneId)).toEqual(["%0", "%7", undefined, undefined, undefined]);
    expect(subject.state.slots.some((slot) => slot.target?.tmuxPaneId === "%6")).toBe(false);
    // Absence of a presence placeholder is not a session death.
    expect(subject.state.retiredSessions).toHaveLength(0);
    expect(subject.state.unassignedSessions).toHaveLength(0);
    expect(lastImage(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    expect(testFixture.activeTimerCount()).toBe(1);
  });

  it("keeps state and rendering unchanged when discovery fails or output is untrusted, and keeps polling", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>()
      .mockResolvedValueOnce([discovered("%0", 0)])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue([discovered("%0", 0)]);
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    await subject.registerVisibleAction(appear(first));
    await subject.startPaneDiscovery();
    const known = subject.state;
    const renders = first.setImage.mock.calls.length;

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS);
    testFixture.runDue();
    await settle();

    expect(subject.state).toBe(known);
    expect(first.setImage).toHaveBeenCalledTimes(renders);
    expect(testFixture.activeTimerCount()).toBe(1);

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS * 2);
    testFixture.runDue();
    await settle();
    expect(discover).toHaveBeenCalledTimes(3);
    expect(subject.state.slots[0]?.target?.tmuxPaneId).toBe("%0");
  });

  it("cancels the poll on stop and never applies a result that arrives after stop", async () => {
    const testFixture = fixture();
    let finish: (panes: readonly DiscoveredPane[]) => void = () => undefined;
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>(() => new Promise((resolve) => { finish = resolve; }));
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    await subject.registerVisibleAction(appear(first));
    const starting = subject.startPaneDiscovery();

    subject.stopPaneDiscovery();
    expect(testFixture.activeTimerCount()).toBe(0);
    finish([discovered("%0", 0)]);
    await starting;
    await settle();

    expect(subject.state.slots.every((slot) => slot.sessionId === undefined)).toBe(true);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS * 4);
    testFixture.runDue();
    await settle();
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("never overlaps polls even when a scheduled tick fires during an in-flight enumeration", async () => {
    const testFixture = fixture();
    let finish: (panes: readonly DiscoveredPane[]) => void = () => undefined;
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>()
      .mockResolvedValueOnce([discovered("%0", 0)])
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([discovered("%0", 0)]);
    const subject = controller(testFixture, { discover });
    await subject.startPaneDiscovery();
    expect(discover).toHaveBeenCalledTimes(1);

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS);
    testFixture.runDue();
    await settle();
    expect(discover).toHaveBeenCalledTimes(2);

    // A tick that arrives while the second poll is still running is skipped...
    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS * 2);
    testFixture.runDue();
    await settle();
    expect(discover).toHaveBeenCalledTimes(2);
    expect(testFixture.activeTimerCount()).toBe(1);

    finish([discovered("%0", 0), discovered("%6", 6)]);
    await settle();
    expect(subject.state.slots[1]?.target?.tmuxPaneId).toBe("%6");
    expect(testFixture.activeTimerCount()).toBe(1);
  });

  it("upgrades a discovered placeholder in place when its tool reports, without a duplicate key", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>().mockResolvedValue([discovered("%0", 0), discovered("%6", 6)]);
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    const second = key("second", 1);
    const free = key("free", 2);
    for (const action of [first, second, free]) await subject.registerVisibleAction(appear(action));
    await subject.startPaneDiscovery();
    const placeholderAssignment = subject.state.slots[1]?.assignmentId;

    await subject.handleStatusEvent(toolEvent(SESSION_STATUS.STARTED, "%6"), 1);

    expect(subject.state.slots[1]).toMatchObject({
      sessionId: TOOL_SESSION_ID,
      source: "claude",
      lifecycle: SESSION_STATUS.STARTED,
      assignmentId: placeholderAssignment,
      target: { tmuxPaneId: "%6" },
    });
    expect(subject.state.slots[2]?.sessionId).toBeUndefined();
    expect(subject.state.slots.filter((slot) => slot.target?.tmuxPaneId === "%6")).toHaveLength(1);
    expect(subject.state.unassignedSessions).toHaveLength(0);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    expect(lastImage(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
  });

  it("never overwrites a real lifecycle, a user-parked session, or an unread completion", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>().mockResolvedValue([discovered("%0", 0), discovered("%6", 6)]);
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    const second = key("second", 1);
    await subject.registerVisibleAction(appear(first));
    await subject.registerVisibleAction(appear(second));
    await subject.handleStatusEvent(toolEvent(SESSION_STATUS.STARTED, "%0"), 1);
    await subject.handleStatusEvent(toolEvent(SESSION_STATUS.COMPLETED, "%6", SECOND_TOOL_SESSION_ID, 2), 2);

    await subject.startPaneDiscovery();

    expect(subject.state.slots[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, source: "claude", lifecycle: SESSION_STATUS.STARTED });
    expect(subject.state.slots[1]).toMatchObject({ sessionId: SECOND_TOOL_SESSION_ID, lifecycle: SESSION_STATUS.COMPLETED, acknowledged: false });
    expect(subject.state.slots.filter((slot) => slot.target?.tmuxPaneId === "%0")).toHaveLength(1);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(lastImage(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.BLUE));

    await subject.handleSendToPlugin(first.id, { type: CLEAR_SLOT_EVENT });
    expect(subject.state.unassignedSessions[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, parkedByUser: true });

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS);
    testFixture.runDue();
    await settle();

    // Discovery found the pane again, but the user's decision still wins.
    expect(subject.state.slots[0]?.sessionId).toBeUndefined();
    expect(subject.state.slots[1]).toMatchObject({ sessionId: SECOND_TOOL_SESSION_ID, lifecycle: SESSION_STATUS.COMPLETED, acknowledged: false });
    expect(lastImage(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.BLUE));
    expect(subject.state.unassignedSessions).toHaveLength(1);
    expect(subject.state.unassignedSessions[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, parkedByUser: true });
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
  });

  it("preserves manual parking when a tool upgrades an unassigned presence entry", async () => {
    const testFixture = fixture();
    const subject = controller(testFixture, { discover: async () => [discovered("%0", 0)] });
    const first = key("first", 0);
    await subject.registerVisibleAction(appear(first));
    await subject.startPaneDiscovery();
    await subject.handleSendToPlugin(first.id, { type: CLEAR_SLOT_EVENT });
    await subject.handleStatusEvent(toolEvent(SESSION_STATUS.STARTED, "%0"), 1);
    expect(subject.state.slots[0]?.sessionId).toBeUndefined();
    expect(subject.state.unassignedSessions).toHaveLength(1);
    expect(subject.state.unassignedSessions[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, source: "claude", parkedByUser: true });
  });

  it("keeps agent hook events authoritative when discovery reports an empty or matching enumeration", async () => {
    const testFixture = fixture();
    const discover = vi.fn<TmuxPaneDiscovery["discover"]>().mockResolvedValue([discovered("%1", 1)]);
    const subject = controller(testFixture, { discover });
    const first = key("first", 0);
    await subject.registerVisibleAction(appear(first));
    discover.mockResolvedValueOnce([]);
    await subject.startPaneDiscovery();
    expect(subject.state.slots.every((slot) => slot.sessionId === undefined)).toBe(true);

    await subject.handleStatusEvent(toolEvent(SESSION_STATUS.STARTED, "%1"), 1);
    expect(subject.state.slots[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, source: "claude", lifecycle: SESSION_STATUS.STARTED });
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));

    testFixture.setNow(PANE_DISCOVERY_INTERVAL_MS);
    testFixture.runDue();
    await settle();

    expect(subject.state.slots[0]).toMatchObject({ sessionId: TOOL_SESSION_ID, source: "claude", lifecycle: SESSION_STATUS.STARTED });
    expect(subject.state.slots.filter((slot) => slot.target?.tmuxPaneId === "%1")).toHaveLength(1);
    expect(lastImage(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
  });
});
