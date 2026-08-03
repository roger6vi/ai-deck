import { describe, expect, it, vi } from "vitest";

import type { AdapterEnvironment } from "../../src/adapters/adapter-environment";
import { deriveAdapterSessionId } from "../../src/adapters/adapter-environment";
import { buildClaudeHookArgv, CLAUDE_HOOK_EXIT_CODE, runClaudeHook } from "../../src/adapters/claude-hook";

const environment: AdapterEnvironment = {
  pluginRoot: "/plugins/com.gentleman.ai-deck.sdPlugin",
  paneId: "%3",
  tmuxSession: "$0",
  nodeBinary: "node",
};

function hookInput(hookEventName: string, sessionId = "ses_1"): string {
  return JSON.stringify({ hook_event_name: hookEventName, session_id: sessionId, cwd: "/repo" });
}

describe("buildClaudeHookArgv", () => {
  it("emits the derived session id and the resolved tmux target", () => {
    expect(buildClaudeHookArgv({ hookEventName: "Stop", sessionId: "ses_1" }, environment)).toEqual([
      "--source", "claude",
      "--session-id", deriveAdapterSessionId("ses_1"),
      "--lifecycle", "completed",
      "--pane-id", "%3",
      "--session", "$0",
    ]);
  });

  it("emits nothing when the hook event carries no lifecycle meaning", () => {
    expect(buildClaudeHookArgv({ hookEventName: "PreToolUse", sessionId: "ses_1" }, environment)).toBeUndefined();
  });

  it("emits nothing when the session runs outside tmux or outside an installed plugin", () => {
    expect(buildClaudeHookArgv({ hookEventName: "Stop", sessionId: "ses_1" }, { ...environment, paneId: undefined })).toBeUndefined();
    expect(buildClaudeHookArgv({ hookEventName: "Stop", sessionId: "ses_1" }, { ...environment, tmuxSession: undefined })).toBeUndefined();
    expect(buildClaudeHookArgv({ hookEventName: "Stop", sessionId: "ses_1" }, { ...environment, pluginRoot: undefined })).toBeUndefined();
  });
});

describe("runClaudeHook", () => {
  it("emits one event for a mapped hook", async () => {
    const emit = vi.fn(async () => 0);

    await runClaudeHook({ input: hookInput("UserPromptSubmit"), environment, emit });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      argv: ["--source", "claude", "--session-id", deriveAdapterSessionId("ses_1"), "--lifecycle", "started", "--pane-id", "%3", "--session", "$0"],
      pluginRoot: environment.pluginRoot,
    });
  });

  it("stays silent for unmapped hooks and unreadable payloads", async () => {
    const emit = vi.fn(async () => 0);

    await runClaudeHook({ input: hookInput("SubagentStop"), environment, emit });
    await runClaudeHook({ input: "not json", environment, emit });
    await runClaudeHook({ input: "", environment, emit });

    expect(emit).not.toHaveBeenCalled();
  });

  it("never fails the Claude session, whatever the plugin answers", async () => {
    await expect(runClaudeHook({ input: hookInput("Stop"), environment, emit: async () => 3 })).resolves.toBe(CLAUDE_HOOK_EXIT_CODE);
    await expect(runClaudeHook({ input: hookInput("Stop"), environment, emit: async () => { throw new Error("socket refused"); } })).resolves.toBe(CLAUDE_HOOK_EXIT_CODE);
    await expect(runClaudeHook({ input: hookInput("PreToolUse"), environment, emit: async () => 0 })).resolves.toBe(CLAUDE_HOOK_EXIT_CODE);
  });
});
