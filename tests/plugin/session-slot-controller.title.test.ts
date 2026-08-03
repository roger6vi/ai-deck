import { describe, expect, it, vi } from "vitest";

import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import { SESSION_SLOT_COLOR } from "../../src/core/colors";
import { SESSION_STATUS, type LocalAgentStatusEvent, type SessionStatus } from "../../src/core/types";
import {
  SessionSlotController,
  sessionSlotSvgDataUri,
  type SessionSlotControllerOptions,
} from "../../src/plugin/session-slot-controller";
import type { SessionWindowNameResolver } from "../../src/plugin/session-slot-title";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID_B = "223e4567-e89b-42d3-a456-426614174000";

interface MockKey {
  readonly id: string;
  readonly coordinates: { readonly column: number; readonly row: number };
  readonly setImage: ReturnType<typeof vi.fn<(image?: string) => Promise<void>>>;
  readonly setTitle: ReturnType<typeof vi.fn<(title?: string) => Promise<void>>>;
}

function key(id: string, column = 0): MockKey {
  return {
    id,
    coordinates: { column, row: 0 },
    setImage: vi.fn<(image?: string) => Promise<void>>().mockResolvedValue(undefined),
    setTitle: vi.fn<(title?: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}

function appear(action: MockKey): WillAppearEvent {
  return {
    action: action as unknown as KeyAction,
    payload: { controller: "Keypad", isInMultiAction: false, coordinates: action.coordinates, resources: {}, settings: {} },
  } as unknown as WillAppearEvent;
}

function status(lifecycle: SessionStatus = SESSION_STATUS.STARTED, timestamp = 1, sessionId = SESSION_ID, pane?: string): LocalAgentStatusEvent {
  const paneId = pane ?? `%${timestamp}`;
  return {
    schemaVersion: 1,
    eventId: `de305d54-75b4-431b-adb2-eb6b9e5460${timestamp.toString().padStart(2, "0")}`,
    source: "opencode",
    sessionId,
    sequence: timestamp,
    timestamp,
    lifecycle,
    target: { tmuxPaneId: paneId, tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function controllerWith(names: Record<string, string | undefined>): { readonly controller: SessionSlotController; readonly resolver: SessionWindowNameResolver } {
  const resolver: SessionWindowNameResolver = { resolve: async (paneId) => names[paneId] };
  const options: SessionSlotControllerOptions = {
    clock: { now: () => 0 },
    scheduler: { schedule: () => undefined, cancel: () => undefined },
    logger: { error: vi.fn() },
    windowNameResolver: resolver,
  };
  return { controller: new SessionSlotController(options), resolver };
}

describe("session slot window name titles", () => {
  it("sets the resolved tmux window name as the key title on assignment", async () => {
    const { controller } = controllerWith({ "%1": "kimi" });
    const action = key("first", 0);
    await controller.registerVisibleAction(appear(action));

    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 1, SESSION_ID, "%1"), 1);

    expect(action.setTitle).toHaveBeenCalledWith("kimi");
    expect(action.setImage).toHaveBeenCalledWith(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
  });

  it("disambiguates duplicate window names with the pane identifier on every sharing slot", async () => {
    const { controller } = controllerWith({ "%1": "kimi", "%7": "kimi" });
    const first = key("first", 0);
    const second = key("second", 1);
    await controller.registerVisibleAction(appear(first));
    await controller.registerVisibleAction(appear(second));

    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 1, SESSION_ID, "%1"), 1);
    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 2, SESSION_ID_B, "%7"), 2);

    expect(first.setTitle).toHaveBeenLastCalledWith("kimi\n·%1");
    expect(second.setTitle).toHaveBeenLastCalledWith("kimi\n·%7");
  });

  it("renders color-only when the window name cannot be resolved", async () => {
    const { controller } = controllerWith({});
    const action = key("first", 0);
    await controller.registerVisibleAction(appear(action));

    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 1, SESSION_ID, "%1"), 1);

    expect(action.setImage).toHaveBeenCalledWith(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.AMBER));
    expect(action.setTitle).not.toHaveBeenCalledWith("kimi");
  });

  it("clears the title when the slot is released", async () => {
    const { controller } = controllerWith({ "%1": "kimi" });
    const action = key("first", 0);
    await controller.registerVisibleAction(appear(action));
    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 1, SESSION_ID, "%1"), 1);
    expect(action.setTitle).toHaveBeenLastCalledWith("kimi");

    await controller.handleStatusEvent(status(SESSION_STATUS.PANE_DISAPPEARED, 2, SESSION_ID, "%1"), 2);

    expect(action.setTitle).toHaveBeenLastCalledWith("");
    expect(action.setImage).toHaveBeenLastCalledWith(sessionSlotSvgDataUri(SESSION_SLOT_COLOR.GRAY));
  });
});
