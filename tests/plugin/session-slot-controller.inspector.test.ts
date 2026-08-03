import { describe, expect, it, vi } from "vitest";

import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import { SESSION_STATUS, type LocalAgentStatusEvent, type SessionStatus } from "../../src/core/types";
import {
  SessionSlotController,
  type SessionSlotControllerOptions,
} from "../../src/plugin/session-slot-controller";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID_B = "223e4567-e89b-42d3-a456-426614174000";

interface MockKey {
  readonly id: string;
  readonly coordinates: { readonly column: number; readonly row: number };
  readonly setImage: ReturnType<typeof vi.fn<(image?: string) => Promise<void>>>;
  readonly setTitle: ReturnType<typeof vi.fn<(title?: string) => Promise<void>>>;
}

interface InspectorStub {
  readonly sent: unknown[];
  readonly inspector: { sendToPropertyInspector(payload: unknown): Promise<void> };
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

function fixture(): { readonly controller: SessionSlotController; readonly inspector: InspectorStub } {
  const stub: InspectorStub = {
    sent: [],
    inspector: { sendToPropertyInspector: async (payload: unknown) => { stub.sent.push(payload); } },
  };
  const options: SessionSlotControllerOptions = {
    clock: { now: () => 0 },
    scheduler: { schedule: () => undefined, cancel: () => undefined },
    logger: { error: vi.fn() },
    windowNameResolver: { resolve: async () => undefined },
    inspector: stub.inspector,
  };
  return { controller: new SessionSlotController(options), inspector: stub };
}

interface SessionListEntry {
  readonly sessionId: string;
  readonly slotIndex: number;
  readonly source: string;
  readonly lifecycle: string;
  readonly title: string;
}

function lastSessions(stub: InspectorStub): readonly SessionListEntry[] {
  const payload = stub.sent.at(-1) as { readonly type: string; readonly sessions: readonly SessionListEntry[] };
  expect(payload.type).toBe("sessions");
  return payload.sessions;
}

describe("session slot property inspector", () => {
  it("pushes the assigned session list when the inspector appears", async () => {
    const { controller, inspector } = fixture();
    const first = key("first", 0);
    await controller.registerVisibleAction(appear(first));
    await controller.handleStatusEvent(status(), 1);

    await controller.handlePropertyInspectorAppeared(first.id);

    const sessions = lastSessions(inspector);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId: SESSION_ID, slotIndex: 0, source: "opencode", lifecycle: "started" });
  });

  it("moves a session to the key slot on set-slot-session, swapping occupants and notifying", async () => {
    const { controller, inspector } = fixture();
    const first = key("first", 0);
    const second = key("second", 1);
    await controller.registerVisibleAction(appear(first));
    await controller.registerVisibleAction(appear(second));
    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 1, SESSION_ID), 1);
    await controller.handleStatusEvent(status(SESSION_STATUS.STARTED, 2, SESSION_ID_B), 2);
    const saves: unknown[] = [];
    controller.subscribeToStateChanges((state) => { saves.push(state); });
    await controller.handlePropertyInspectorAppeared(second.id);

    await controller.handleSendToPlugin(second.id, { type: "set-slot-session", sessionId: SESSION_ID });

    expect(controller.state.slots[0]?.sessionId).toBe(SESSION_ID_B);
    expect(controller.state.slots[1]?.sessionId).toBe(SESSION_ID);
    expect(saves).toHaveLength(1);
    expect(lastSessions(inspector).find((session) => session.sessionId === SESSION_ID)?.slotIndex).toBe(1);
  });

  it("ignores malformed, unknown-session, and unknown-context selections without changing state", async () => {
    const { controller, inspector } = fixture();
    const first = key("first", 0);
    await controller.registerVisibleAction(appear(first));
    await controller.handleStatusEvent(status(), 1);
    const before = controller.state;
    inspector.sent.length = 0;

    await controller.handleSendToPlugin(first.id, { type: "set-slot-session", sessionId: "not-a-uuid" });
    await controller.handleSendToPlugin(first.id, { type: "something-else", sessionId: SESSION_ID });
    await controller.handleSendToPlugin(first.id, null);
    await controller.handleSendToPlugin(first.id, { type: "set-slot-session", sessionId: SESSION_ID_B });
    await controller.handleSendToPlugin("unknown-context", { type: "set-slot-session", sessionId: SESSION_ID });

    expect(controller.state).toBe(before);
    expect(inspector.sent).toHaveLength(0);
  });

  it("pushes list updates on later state changes only while the inspector is open", async () => {
    const { controller, inspector } = fixture();
    const first = key("first", 0);
    await controller.registerVisibleAction(appear(first));
    await controller.handlePropertyInspectorAppeared(first.id);
    inspector.sent.length = 0;

    await controller.handleStatusEvent(status(), 1);
    expect(lastSessions(inspector)).toHaveLength(1);

    controller.handlePropertyInspectorDisappeared();
    inspector.sent.length = 0;
    await controller.handleStatusEvent(status(SESSION_STATUS.COMPLETED, 2), 2);
    expect(inspector.sent).toHaveLength(0);
  });
});
