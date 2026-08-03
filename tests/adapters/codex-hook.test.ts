import { describe, expect, it, vi } from "vitest";

import type { AdapterEnvironment } from "../../src/adapters/adapter-environment";
import { deriveAdapterSessionId } from "../../src/adapters/adapter-environment";
import { buildCodexHookArgv, CODEX_HOOK_EXIT_CODE, runCodexHook } from "../../src/adapters/codex-hook";

const environment: AdapterEnvironment = {
  pluginRoot: "/plugins/com.gentleman.ai-deck.sdPlugin",
  paneId: "%3",
  tmuxSession: "$0",
  nodeBinary: "node",
};

const INPUT = JSON.stringify({ session_id: "thread_1", cwd: "/repo" });

describe("buildCodexHookArgv", () => {
  it("emits the derived session id, the declared lifecycle and the tmux target", () => {
    expect(buildCodexHookArgv("thread_1", "completed", environment)).toEqual([
      "--source", "codex",
      "--session-id", deriveAdapterSessionId("thread_1"),
      "--lifecycle", "completed",
      "--pane-id", "%3",
      "--session", "$0",
    ]);
  });

  it("emits nothing outside tmux or outside an installed plugin", () => {
    expect(buildCodexHookArgv("thread_1", "completed", { ...environment, paneId: undefined })).toBeUndefined();
    expect(buildCodexHookArgv("thread_1", "completed", { ...environment, tmuxSession: undefined })).toBeUndefined();
    expect(buildCodexHookArgv("thread_1", "completed", { ...environment, pluginRoot: undefined })).toBeUndefined();
  });
});

describe("runCodexHook", () => {
  it("emits one event for the lifecycle its hook entry declares", async () => {
    const emit = vi.fn(async () => 0);

    await runCodexHook({ input: INPUT, argv: ["--lifecycle", "started"], environment, emit });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      argv: ["--source", "codex", "--session-id", deriveAdapterSessionId("thread_1"), "--lifecycle", "started", "--pane-id", "%3", "--session", "$0"],
      pluginRoot: environment.pluginRoot,
    });
  });

  it("stays silent on an unreadable payload or a lifecycle it does not accept", async () => {
    const emit = vi.fn(async () => 0);

    await runCodexHook({ input: "not json", argv: ["--lifecycle", "started"], environment, emit });
    await runCodexHook({ input: INPUT, argv: ["--lifecycle", "error"], environment, emit });
    await runCodexHook({ input: INPUT, argv: [], environment, emit });

    expect(emit).not.toHaveBeenCalled();
  });

  it("never fails the Codex session, whatever the plugin answers", async () => {
    await expect(runCodexHook({ input: INPUT, argv: ["--lifecycle", "started"], environment, emit: async () => 3 })).resolves.toBe(CODEX_HOOK_EXIT_CODE);
    await expect(runCodexHook({ input: INPUT, argv: ["--lifecycle", "started"], environment, emit: async () => { throw new Error("refused"); } })).resolves.toBe(CODEX_HOOK_EXIT_CODE);
  });
});
