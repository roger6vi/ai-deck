import { describe, expect, it, vi } from "vitest";

import type { KeyAction, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { SessionSlotActionBase } from "../../src/actions/session-slot-base";
import { SESSION_SLOT_COLOR } from "../../src/core/colors";
import { SESSION_REDUCER_LIMITS } from "../../src/core/reducer";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";
import { NAVIGATION_OUTCOME, type AssignedTargetNavigator } from "../../src/navigation/ghostty-tmux";
import {
  SESSION_SLOT_NAVIGATION_ERROR,
  SessionSlotController,
  sessionSlotSvgDataUri,
} from "../../src/plugin/session-slot-controller";

vi.mock("@elgato/streamdeck", () => ({
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

const SESSION_IDS = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
  "323e4567-e89b-42d3-a456-426614174000",
] as const;

const DISABLED_GRAY_PAINT = "#6B7280";

interface MockKey {
  readonly id: string;
  readonly coordinates?: { readonly column: number; readonly row: number };
  readonly setImage: ReturnType<typeof vi.fn<(image?: string) => Promise<void>>>;
}

interface EventOptions {
  readonly eventId?: string;
  readonly lifecycle?: LocalAgentStatusEvent["lifecycle"];
  readonly sessionId?: string;
  readonly timestamp?: number;
  readonly tmuxPaneId?: string;
}

function key(id: string, column?: number, row = 0): MockKey {
  return {
    id,
    ...(column === undefined ? {} : { coordinates: { column, row } }),
    setImage: vi.fn<(image?: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}

function appear(action: MockKey, controller = "Keypad"): WillAppearEvent {
  return {
    action: action as unknown as KeyAction,
    payload: { controller, isInMultiAction: false, coordinates: action.coordinates, resources: {}, settings: {} },
  } as unknown as WillAppearEvent;
}

function status(options: EventOptions = {}): LocalAgentStatusEvent {
  const timestamp = options.timestamp ?? 1;
  return {
    schemaVersion: 1,
    eventId: options.eventId ?? `de305d54-75b4-431b-adb2-eb6b9e5460${timestamp.toString().padStart(2, "0")}`,
    source: "opencode",
    sessionId: options.sessionId ?? SESSION_IDS[0],
    sequence: timestamp,
    timestamp,
    lifecycle: options.lifecycle ?? SESSION_STATUS.STARTED,
      target: { tmuxPaneId: options.tmuxPaneId ?? `%${timestamp}`, tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function controllerWith(navigator: AssignedTargetNavigator, logger = vi.fn()): SessionSlotController {
  return new SessionSlotController({
    clock: { now: () => 10 },
    scheduler: { schedule: () => 0, cancel: () => undefined },
    logger: { error: logger },
    navigator,
  });
}

function imageFor(action: MockKey): string {
  const image = action.setImage.mock.calls.at(-1)?.[0];
  if (image === undefined) throw new Error("Expected a rendered image.");
  return image;
}

const SVG_BASE64_PREFIX = "data:image/svg+xml;base64,";

function decodeSdkSvgImage(image: string): string {
  if (!image.startsWith(SVG_BASE64_PREFIX)) throw new Error("Unsupported Stream Deck image format.");
  return Buffer.from(image.slice(SVG_BASE64_PREFIX.length), "base64").toString("utf8");
}

describe("session slot Stream Deck integration", () => {
  it("renders free slots disabled gray, preserves assigned green after physical acknowledgement, and releases disappeared panes to gray", async () => {
    const navigate = vi.fn<AssignedTargetNavigator["navigate"]>().mockResolvedValue(NAVIGATION_OUTCOME.NAVIGATED);
    const controller = controllerWith({ navigate });
    const action = new SessionSlotActionBase(controller, () => 4);
    const keys = Array.from({ length: SESSION_REDUCER_LIMITS.SLOT_COUNT }, (_, index) => key(`key-${index}`, index));
    const first = keys[0];
    const second = keys[1];
    if (first === undefined || second === undefined) throw new Error("Expected five visible session keys.");
    await Promise.all(keys.map((visible) => action.onWillAppear(appear(visible))));

    expect(keys).toHaveLength(SESSION_REDUCER_LIMITS.SLOT_COUNT);
    expect(keys.map(imageFor)).toEqual(keys.map(() => sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY)));
    for (const visible of keys) expect(decodeSdkSvgImage(imageFor(visible))).toContain(`fill="${DISABLED_GRAY_PAINT}"`);

    await controller.handleStatusEvent(status(), 1);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", sessionId: SESSION_IDS[1], timestamp: 2 }), 2);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546003", sessionId: SESSION_IDS[2], timestamp: 3 }), 3);

    expect(keys.map(imageFor)).toEqual([
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER),
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER),
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER),
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY),
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY),
    ]);

    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546004", lifecycle: SESSION_STATUS.COMPLETED, timestamp: 4 }), 4);
    await action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    expect(controller.state.slots[0]?.sessionId).toBe(SESSION_IDS[0]);
    expect(navigate).toHaveBeenCalledWith({ tmuxPaneId: "%4", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" });

    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546005", lifecycle: SESSION_STATUS.PANE_DISAPPEARED, sessionId: SESSION_IDS[1], timestamp: 5 }), 5);
    expect(imageFor(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
    expect(controller.state.slots[1]?.sessionId).toBeUndefined();
  });

  it("registers only row-zero slot contexts and ignores every invalid coordinate safely", async () => {
    const controller = controllerWith({ navigate: vi.fn().mockResolvedValue(NAVIGATION_OUTCOME.NAVIGATED) });
    const keys = Array.from({ length: SESSION_REDUCER_LIMITS.SLOT_COUNT }, (_, index) => key(`key-${index}`, index));
    const invalid = [key("missing"), key("row", 0, 1), key("negative", -1), key("past", SESSION_REDUCER_LIMITS.SLOT_COUNT), key("fraction", 0.5), key("nan", Number.NaN), key("infinity", Number.POSITIVE_INFINITY)];

    await Promise.all(keys.map((action) => controller.registerVisibleAction(appear(action))));
    await Promise.all(invalid.map((action) => controller.registerVisibleAction(appear(action))));
    await controller.registerVisibleAction(appear(key("dial", 0), "Encoder"));

    expect(keys.map(imageFor)).toEqual(keys.map(() => sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY)));
    expect(controller.visibleContextCount).toBe(SESSION_REDUCER_LIMITS.SLOT_COUNT);
  });

  it("renders only affected visible contexts for lifecycle changes, keeping running amber and reserving red for errors", async () => {
    const controller = new SessionSlotController();
    const first = key("first", 0);
    const second = key("second", 1);
    await controller.registerVisibleAction(appear(first));
    await controller.registerVisibleAction(appear(second));

    await controller.handleStatusEvent(status(), 1);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    await controller.refresh(Number.MAX_SAFE_INTEGER);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", lifecycle: SESSION_STATUS.ERROR, timestamp: 2 }), 2);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.RED));
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546003", lifecycle: SESSION_STATUS.COMPLETED, timestamp: 3 }), 3);

    expect([imageFor(first), imageFor(second)]).toEqual([
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.BLUE),
      sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY),
    ]);
    expect(first.setImage).toHaveBeenCalledTimes(4);
    expect(second.setImage).toHaveBeenCalledTimes(1);
  });

  it("never acknowledges on visibility and only an assigned physical key press changes blue to green", async () => {
    const controller = controllerWith({ navigate: vi.fn().mockResolvedValue(NAVIGATION_OUTCOME.NAVIGATED) });
    const action = new SessionSlotActionBase(controller, () => 2);
    const first = key("first", 0);
    await action.onWillAppear(appear(first));
    await controller.handleStatusEvent(status(), 1);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", lifecycle: SESSION_STATUS.COMPLETED, timestamp: 2 }), 2);
    await action.onWillAppear(appear(first));

    expect(controller.state.slots[0]?.acknowledged).toBe(false);
    await action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent);
    await action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent);

    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
    expect(first.setImage).toHaveBeenCalledTimes(5);
  });

  it("keeps contexts and sessions independent, releases only from pane-disappeared, and cleans up safely", async () => {
    const controller = new SessionSlotController();
    const action = new SessionSlotActionBase(controller, () => 3);
    const first = key("first", 0);
    const second = key("second", 1);
    await action.onWillAppear(appear(first));
    await action.onWillAppear(appear(second));
    await controller.handleStatusEvent(status(), 1);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", sessionId: SESSION_IDS[1], timestamp: 2 }), 2);
    await action.onWillDisappear({ action: first as unknown as KeyAction } as unknown as WillDisappearEvent);

    expect(controller.state.slots[0]?.sessionId).toBe(SESSION_IDS[0]);
    await action.onWillAppear(appear(first));
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546003", lifecycle: SESSION_STATUS.PANE_DISAPPEARED, timestamp: 3 }), 3);
    expect(controller.state.slots[0]?.sessionId).toBeUndefined();
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
    expect(imageFor(second)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(Object.isFrozen(controller.state)).toBe(true);
  });

  it("uses explicit SVG paints in SDK-supported base64 images and contains rejected direct renders", async () => {
    const controller = new SessionSlotController();
    const rejected = key("rejected", 0);
    rejected.setImage.mockRejectedValueOnce(new Error("offline"));

    await controller.registerVisibleAction(appear(rejected));
    await controller.refresh(0);
    controller.unregisterVisibleAction(rejected.id);
    await controller.handleStatusEvent(status(), 1);

    const expectedPaints = [
      [SESSION_SLOT_COLOR.GRAY, DISABLED_GRAY_PAINT],
      [SESSION_SLOT_COLOR.GREEN, "#008000"],
      [SESSION_SLOT_COLOR.AMBER, "#FFBF00"],
      [SESSION_SLOT_COLOR.RED, "#FF0000"],
      [SESSION_SLOT_COLOR.BLUE, "#0000FF"],
    ] as const;

    expect(rejected.setImage).toHaveBeenCalledTimes(2);
    for (const [color, paint] of expectedPaints) {
      const svg = decodeSdkSvgImage(sessionSlotSvgDataUri(color));
      expect(svg).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" fill="${paint}"/></svg>`);
      expect(svg).not.toMatch(/fill="(?:amber|black)"/);
      expect(svg).not.toMatch(/metadata|prompt|session|content/i);
    }
  });

  it("uses disabled gray while unassigned and amber for started sessions through a strict image host", async () => {
    const controller = new SessionSlotController();
    const action = key("contract-host", 0);
    action.setImage.mockImplementation(async (image) => { decodeSdkSvgImage(image ?? ""); });

    await expect(action.setImage("data:image/svg+xml,%3Csvg%3E")).rejects.toThrow("Unsupported Stream Deck image format.");
    action.setImage.mockClear();

    await controller.registerVisibleAction(appear(action));
    expect(decodeSdkSvgImage(imageFor(action))).toContain(`fill="${DISABLED_GRAY_PAINT}"`);

    await controller.handleStatusEvent(status(), 1);
    expect(decodeSdkSvgImage(imageFor(action))).toContain('fill="#FFBF00"');
  });

  it("releases only a still-matching missing target and retains ambiguous completed assignments as acknowledged", async () => {
    const controller = controllerWith({ navigate: vi.fn().mockResolvedValue(NAVIGATION_OUTCOME.MISSING) }); const action = new SessionSlotActionBase(controller, () => 2); const first = key("first", 0);
    await action.onWillAppear(appear(first));
    await controller.handleStatusEvent(status({ tmuxPaneId: "%1" }), 1);
    await action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent);
    expect(controller.state.slots[0]?.sessionId).toBeUndefined();
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
    const ambiguousController = controllerWith({ navigate: vi.fn().mockResolvedValue(NAVIGATION_OUTCOME.AMBIGUOUS) }); const ambiguousAction = new SessionSlotActionBase(ambiguousController, () => 2); const ambiguousKey = key("ambiguous", 0);
    await ambiguousAction.onWillAppear(appear(ambiguousKey));
    await ambiguousController.handleStatusEvent(status({ tmuxPaneId: "%2" }), 1);
    await ambiguousController.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", lifecycle: SESSION_STATUS.COMPLETED, tmuxPaneId: "%2", timestamp: 2 }), 2);

    await ambiguousAction.onKeyDown({ action: ambiguousKey as unknown as KeyAction } as KeyDownEvent);
    expect(ambiguousController.state.slots[0]?.sessionId).toBe(SESSION_IDS[0]);
    expect(imageFor(ambiguousKey)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GREEN));
  });

  it("contains unavailable navigation without acknowledging or exposing process details, and ignores unassigned presses", async () => {
    const logger = vi.fn(); const navigate = vi.fn<AssignedTargetNavigator["navigate"]>().mockRejectedValue(new Error("sensitive stdout target %99")); const controller = controllerWith({ navigate }, logger); const action = new SessionSlotActionBase(controller, () => 2); const first = key("first", 0); const free = key("free", 1);
    await action.onWillAppear(appear(first)); await action.onWillAppear(appear(free));
    await controller.handleStatusEvent(status(), 1);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", lifecycle: SESSION_STATUS.COMPLETED, timestamp: 2 }), 2);

    await action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent); await action.onKeyDown({ action: free as unknown as KeyAction } as KeyDownEvent);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.BLUE));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(SESSION_SLOT_NAVIGATION_ERROR);
    expect(logger.mock.calls.flat()).not.toContain("sensitive stdout target %99");
  });

  it("does not let a delayed missing result mutate a restarted same-value assignment", async () => {
    let resolveNavigation: ((outcome: typeof NAVIGATION_OUTCOME.MISSING) => void) | undefined;
    const navigate = vi.fn<AssignedTargetNavigator["navigate"]>().mockImplementation(() => new Promise((resolve) => { resolveNavigation = resolve; })); const controller = controllerWith({ navigate }); const action = new SessionSlotActionBase(controller, () => 2); const first = key("first", 0);
    await action.onWillAppear(appear(first));
    await controller.handleStatusEvent(status({ tmuxPaneId: "%1" }), 1);
    const press = action.onKeyDown({ action: first as unknown as KeyAction } as KeyDownEvent);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546002", lifecycle: SESSION_STATUS.PANE_DISAPPEARED, tmuxPaneId: "%1", timestamp: 2 }), 2);
    await controller.handleStatusEvent(status({ eventId: "de305d54-75b4-431b-adb2-eb6b9e546003", lifecycle: SESSION_STATUS.STARTED, tmuxPaneId: "%1", timestamp: 3 }), 3);
    if (resolveNavigation === undefined) throw new Error("Expected navigation to begin."); resolveNavigation(NAVIGATION_OUTCOME.MISSING); await press;
    expect(controller.state.slots[0]?.sessionId).toBe(SESSION_IDS[0]);
    expect(imageFor(first)).toBe(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
  });
});
