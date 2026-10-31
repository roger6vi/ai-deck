import { describe, expect, it, vi } from "vitest";

import { createSessionState, reduceSessionState, SESSION_REDUCER_ACTION, type SessionState } from "../../src/core/reducer";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";
import type { TmuxPaneEnumeratorProcess } from "../../src/persistence/session-state-reconciler";
import {
  createTmuxPaneNamer,
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
  it("queries tmux for the pane name, falling back to the window name, and returns it trimmed", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "0kimi\n" });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBe("kimi");
    expect(execute).toHaveBeenCalledExactlyOnceWith("tmux", ["display-message", "-t", "%1", "-p", "#{?#{!=:#{@aideck_name},},1,0}#{?#{!=:#{@aideck_name},},#{@aideck_name},#{window_name}}"]);
  });

  it("strips control characters and bounds the name length", async () => {
    const longName = "kimibell" + "x".repeat(100);
    const execute = vi.fn().mockResolvedValue({ stdout: "0" + longName });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    const resolved = await resolver.resolve("%1");
    expect(resolved).toBe("kimibell" + "x".repeat(SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH - "kimibell".length));
    expect(resolved).toHaveLength(SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH);
  });

  it("splits a stored name on its line separator back into lines", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "1WED|Photo|Library\n" });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBe("WED\nPhoto\nLibrary");
  });

  it("returns undefined for empty or whitespace-only names", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "0  \n" });
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBeUndefined();
  });

  it("preserves literal separators and the original length bound in fallback window names", async () => {
    const windowName = "api|worker" + "x".repeat(30);
    const execute = vi.fn(async (_command: string, args: readonly string[]) => ({
      stdout: (args.at(-1)?.includes(",1,0}") ? "0" : "") + windowName + "\n",
    }));
    const resolver = createTmuxWindowNameResolver({ process: { execute } });
    await expect(resolver.resolve("%1")).resolves.toBe(windowName.slice(0, SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH));
  });

  it("fails open to undefined when tmux cannot answer", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("tmux unavailable"));
    const resolver = createTmuxWindowNameResolver({ process: { execute } });

    await expect(resolver.resolve("%1")).resolves.toBeUndefined();
  });
});

describe("createTmuxPaneNamer", () => {
  it("stores the name as a pane option and as the pane title", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await createTmuxPaneNamer({ process: { execute } }).rename("%2", "  api  ");

    expect(execute).toHaveBeenNthCalledWith(1, "tmux", ["set-option", "-p", "-t", "%2", "@aideck_name", "api"]);
    expect(execute).toHaveBeenNthCalledWith(2, "tmux", ["select-pane", "-t", "%2", "-T", "api"]);
  });

  it("doubles # in the pane title because tmux expands formats there, and keeps it literal in the option", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await createTmuxPaneNamer({ process: { execute } }).rename("%2", "a#{pid}");

    expect(execute).toHaveBeenNthCalledWith(1, "tmux", ["set-option", "-p", "-t", "%2", "@aideck_name", "a#{pid}"]);
    expect(execute).toHaveBeenNthCalledWith(2, "tmux", ["select-pane", "-t", "%2", "-T", "a##{pid}"]);
  });

  it("clears the pane option when the name is empty after sanitizing", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await createTmuxPaneNamer({ process: { execute } }).rename("%2", " \u0007 ");

    expect(execute).toHaveBeenCalledExactlyOnceWith("tmux", ["set-option", "-p", "-u", "-t", "%2", "@aideck_name"]);
  });

  it("drops leading dashes so tmux never reads the name as a flag", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await createTmuxPaneNamer({ process: { execute } }).rename("%2", "--x ok");

    expect(execute).toHaveBeenNthCalledWith(1, "tmux", ["set-option", "-p", "-t", "%2", "@aideck_name", "x ok"]);
  });

  it("keeps up to three lines, cuts each to the key width, and joins them with a space in the title", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await createTmuxPaneNamer({ process: { execute } }).rename("%2", "first line is long\n\n second\r\nthird\nfourth");

    expect(execute).toHaveBeenNthCalledWith(1, "tmux", ["set-option", "-p", "-t", "%2", "@aideck_name", "first line|second|third"]);
    expect(execute).toHaveBeenNthCalledWith(2, "tmux", ["select-pane", "-t", "%2", "-T", "first line second third"]);
  });

  it("bounds the name length and refuses a malformed pane id without running tmux", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });
    const namer = createTmuxPaneNamer({ process: { execute } });

    await namer.rename("%2; kill-server", "x");
    expect(execute).not.toHaveBeenCalled();

    await namer.rename("%2", "y".repeat(100));
    expect(execute.mock.calls[0]?.[1]).toContain("y".repeat(SESSION_SLOT_TITLE_LIMITS.MAX_PANE_NAME_LINE_LENGTH));
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

  it("marks every slot that shares a window name, so none is identified only by elimination", () => {
    const state = stateWith([["%1", SESSION_ID, 1], ["%7", SESSION_ID_B, 2], ["%9", SESSION_ID_C, 3]]);
    const titles = resolveSlotTitles(state, () => "kimi");

    expect(titles[0]).toBe("kimi\n·%1");
    expect(titles[1]).toBe("kimi\n·%7");
    expect(titles[2]).toBe("kimi\n·%9");
  });

  it("only groups duplicates by identical resolved names", () => {
    const state = stateWith([["%1", SESSION_ID, 1], ["%7", SESSION_ID_B, 2]]);
    const names = new Map([["%1", "kimi"], ["%7", "opencode"]]);
    const titles = resolveSlotTitles(state, (pane) => names.get(pane));

    expect(titles[0]).toBe("kimi");
    expect(titles[1]).toBe("opencode");
  });
});
