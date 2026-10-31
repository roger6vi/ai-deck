import { describe, expect, it, vi } from "vitest";

import { UUID_V4_PATTERN } from "../../src/core/events";
import {
  createTmuxPaneDiscovery,
  deriveDiscoveredPaneSessionId,
  PANE_DISCOVERY_FORMAT,
  type PaneDiscoveryProcess,
} from "../../src/persistence/pane-discovery";
import {
  createTmuxPaneEnumerator,
  type TmuxPaneEnumeratorProcess,
} from "../../src/persistence/session-state-reconciler";

function processFor(outputs: readonly (string | Error)[]): PaneDiscoveryProcess & { readonly execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn<(command: string, args: readonly string[]) => Promise<{ readonly stdout: string }>>();
  for (const output of outputs) {
    if (output instanceof Error) execute.mockRejectedValueOnce(output);
    else execute.mockResolvedValueOnce({ stdout: output });
  }
  return { execute };
}

describe("createTmuxPaneDiscovery", () => {
  it("enumerates printable pipe-separated pane, session, and window identifiers", async () => {
    const process = processFor(["%0|$0|@0\n%6|$0|@1\n"]);

    const panes = await createTmuxPaneDiscovery({ process }).discover();

    expect(process.execute.mock.calls).toEqual([["tmux", ["list-panes", "-a", "-F", PANE_DISCOVERY_FORMAT]]]);
    expect(PANE_DISCOVERY_FORMAT).toBe("#{pane_id}|#{session_id}|#{window_id}");
    expect(PANE_DISCOVERY_FORMAT).not.toContain("\t");
    expect(panes?.map((pane) => pane.target)).toEqual([
      { tmuxPaneId: "%0", tmuxSession: "$0", tmuxWindow: "@0", ghosttyBundleId: "com.mitchellh.ghostty" },
      { tmuxPaneId: "%6", tmuxSession: "$0", tmuxWindow: "@1", ghosttyBundleId: "com.mitchellh.ghostty" },
    ]);
    for (const pane of panes ?? []) expect(pane.sessionId).toMatch(UUID_V4_PATTERN);
    expect(new Set(panes?.map((pane) => pane.sessionId)).size).toBe(2);
  });

  it("derives a stable version-4 identity scoped by tmux session and pane", async () => {
    const first = await createTmuxPaneDiscovery({ process: processFor(["%0|$0|@0\n%0|$1|@0\n"]) }).discover();
    const repeat = await createTmuxPaneDiscovery({ process: processFor(["%0|$0|@0\n%0|$1|@0\n"]) }).discover();

    expect(first?.[0]?.sessionId).toBe(repeat?.[0]?.sessionId);
    // Two tmux servers may both own a pane called %0; the session scopes it.
    expect(first?.[0]?.sessionId).not.toBe(first?.[1]?.sessionId);
    expect(deriveDiscoveredPaneSessionId("$0", "%0")).toMatch(UUID_V4_PATTERN);
  });

  it("fails closed on any malformed, truncated, extra-field, or control-bearing row", async () => {
    const untrusted = [
      "%0|$0|@0|extra\n",
      "%0|$0\n",
      "%0|$0|not-a-window-id\n",
      "pane-1|$0|@0\n",
      "%0|x$0|@0\n",
      "%0|$0|@0\n%bad|$0|@1\n",
      "%0|$0|@0\n%6|$0|@9\u0007\n",
      "%0\t$0\t@0\n",
    ];
    for (const stdout of untrusted) {
      expect(await createTmuxPaneDiscovery({ process: processFor([stdout]) }).discover()).toBeUndefined();
    }
  });

  it("fails closed when tmux itself is unavailable", async () => {
    expect(await createTmuxPaneDiscovery({ process: processFor([new Error("ENOENT")]) }).discover()).toBeUndefined();
  });

  it("reports an empty list for a complete enumeration with no panes", async () => {
    expect(await createTmuxPaneDiscovery({ process: processFor([""]) }).discover()).toEqual([]);
  });
});

describe("existing pane reconciliation enumerator", () => {
  it("still reports the pane-id set used for startup reconciliation", async () => {
    const process: TmuxPaneEnumeratorProcess = {
      execute: async (command, args) => {
        expect(args).toEqual(["list-panes", "-a", "-F", "#{pane_id}"]);
        return { stdout: "%0\n%6\n" };
      },
    };
    expect(await createTmuxPaneEnumerator({ process }).enumerate()).toEqual(new Set(["%0", "%6"]));
  });
});
