import { describe, expect, it, vi } from "vitest";

import { createSessionState, reduceSessionState, SESSION_REDUCER_ACTION, type SessionState } from "../../src/core/reducer";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";
import type { TmuxPaneEnumeratorProcess } from "../../src/persistence/session-state-reconciler";
import {
  createTmuxWindowNameResolver,
  resolveSlotTitles,
  SESSION_SLOT_TITLE_LIMITS,
} from "../../src/plugin/session-slot-title";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID_B = "223e4567-e89b-42d3-a456-426614174000";
const SESSION_ID_C = "323e4567-e89b-42d3-a456-426614174000";

function eventFor(pane: string, sessionId: string, timestamp: number): LocalAgentStatusEvent {
  return {
    schemaVersion: 1,
    eventId: `de305d54-75b4-431b-adb2-eb6b9e5460${timestamp.toString().padStart(2, "0")}`,
    source: "opencode",
    sessionId,
    sequence: timestamp,
    timestamp,
    lifecycle: SESSION_STATUS.STARTED,
    target: { tmuxPaneId: pane, tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function stateWith(entries: readonly (readonly [string, string, number])[]): SessionState {
  let state = createSessionState();
  for (const [pane, sessionId, timestamp] of entries) {
    state = reduceSessionState(state, { kind: SESSION_REDUCER_ACTION.EVENT, event: eventFor(pane, sessionId, timestamp) });
  }
  return state;
}

describe("createTmuxWindowNameResolver", () => {
  it("queries tmux for the pane window name and returns it trimmed", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "kimi\n" });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBe("kimi");
    expect(execute).toHaveBeenCalledExactlyOnceWith("tmux", ["display-message", "-t", "%1", "-p", "#{window_name}"]);
  });

  it("strips control characters and bounds the name length", async () => {
    const longName = "kimibell" + "x".repeat(100);
    const execute = vi.fn().mockResolvedValue({ stdout: longName });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    const resolved = await resolver.resolve("%1");
    expect(resolved).toBe("kimibell" + "x".repeat(SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH - "kimibell".length));
    expect(resolved).toHaveLength(SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH);
  });

  it("returns undefined for empty or whitespace-only names", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "  \n" });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBeUndefined();
  });

  it("fails open to undefined when tmux cannot answer", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("tmux unavailable"));
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBeUndefined();
  });
});

describe("resolveSlotTitles", () => {
  it("returns undefined for unassigned slots and the bare name for a unique assignment", () => {
    const state = stateWith([["%1", SESSION_ID, 1]]);
    const titles = resolveSlotTitles(state, () => "kimi");

    expect(titles[0]).toBe("kimi");
    expect(titles[1]).toBeUndefined();
    expect(titles[4]).toBeUndefined();
  });

  it("returns undefined for assigned slots whose name could not be resolved", () => {
    const state = stateWith([["%1", SESSION_ID, 1]]);

    expect(resolveSlotTitles(state, () => undefined)[0]).toBeUndefined();
  });

  it("keeps the bare name on the lowest-index duplicate and suffixes the rest with the pane id", () => {
    const state = stateWith([["%1", SESSION_ID, 1], ["%7", SESSION_ID_B, 2], ["%9", SESSION_ID_C, 3]]);
    const titles = resolveSlotTitles(state, () => "kimi");

    expect(titles[0]).toBe("kimi");
    expect(titles[1]).toBe("kimi ·%7");
    expect(titles[2]).toBe("kimi ·%9");
  });

  it("only groups duplicates by identical resolved names", () => {
    const state = stateWith([["%1", SESSION_ID, 1], ["%7", SESSION_ID_B, 2]]);
    const names = new Map([["%1", "kimi"], ["%7", "opencode"]]);
    const titles = resolveSlotTitles(state, (pane) => names.get(pane));

    expect(titles[0]).toBe("kimi");
    expect(titles[1]).toBe("opencode");
  });
});
