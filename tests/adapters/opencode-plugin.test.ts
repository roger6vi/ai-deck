import { describe, expect, it } from "vitest";

import type { AdapterEnvironment } from "../../src/adapters/adapter-environment";
import { createOpenCodePluginHooks, type OpenCodeSpawn } from "../../src/adapters/opencode-plugin";

const environment: AdapterEnvironment = {
  pluginRoot: "/plugins/com.gentleman.ai-deck.sdPlugin",
  paneId: "%3",
  tmuxSession: "$0",
  nodeBinary: "node",
};

function recorder(): { readonly calls: string[][]; readonly spawn: OpenCodeSpawn } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: (_command, args) => {
      calls.push([...args]);
      return { on: () => undefined, unref: () => undefined };
    },
  };
}

function flagOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

const busy = (sessionID: string) => ({ type: "session.status", properties: { sessionID, status: { type: "busy" } } });
const idle = (sessionID: string) => ({ type: "session.idle", properties: { sessionID } });

describe("createOpenCodePluginHooks", () => {
  it("numbers a session's events so a fast turn cannot be discarded as stale", async () => {
    const { calls, spawn } = recorder();
    const hooks = createOpenCodePluginHooks(environment, spawn);

    await hooks.event({ event: busy("ses_1") });
    await hooks.event({ event: idle("ses_1") });

    // The timestamp is stamped inside the spawned child, so two events a
    // couple of milliseconds apart can be stamped out of order. The sequence
    // is what lets the plugin order them regardless.
    expect(flagOf(calls[0] ?? [], "--lifecycle")).toBe("started");
    expect(flagOf(calls[1] ?? [], "--lifecycle")).toBe("completed");
    expect(Number(flagOf(calls[1] ?? [], "--sequence"))).toBeGreaterThan(Number(flagOf(calls[0] ?? [], "--sequence")));
    // Observed at the event, not at child startup, so the order survives.
    expect(Number(flagOf(calls[1] ?? [], "--timestamp"))).toBeGreaterThanOrEqual(Number(flagOf(calls[0] ?? [], "--timestamp")));
  });

  it("counts each session on its own", async () => {
    const { calls, spawn } = recorder();
    const hooks = createOpenCodePluginHooks(environment, spawn);

    await hooks.event({ event: busy("ses_1") });
    await hooks.event({ event: busy("ses_2") });

    expect(flagOf(calls[0] ?? [], "--sequence")).toBe(flagOf(calls[1] ?? [], "--sequence"));
  });

  it("emits nothing when the session runs outside tmux", async () => {
    const { calls, spawn } = recorder();
    const hooks = createOpenCodePluginHooks({ ...environment, paneId: undefined }, spawn);

    await hooks.event({ event: busy("ses_1") });

    expect(calls).toHaveLength(0);
  });
});
