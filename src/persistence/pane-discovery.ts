import { createHash } from "node:crypto";

import type { DiscoveredPaneEntry } from "../core/reducer";
import { productionEnumeratorProcess, type TmuxPaneEnumeratorProcess } from "./session-state-reconciler";

export const PANE_DISCOVERY_INTERVAL_MS = 5000;
export const PANE_DISCOVERY_FORMAT = "#{pane_id}|#{session_id}|#{window_id}";
export type DiscoveredPane = DiscoveredPaneEntry;
export type PaneDiscoveryProcess = TmuxPaneEnumeratorProcess;
export interface TmuxPaneDiscovery {
  discover(): Promise<readonly DiscoveredPane[] | undefined>;
}

export function deriveDiscoveredPaneSessionId(session: string, pane: string): string {
  const hex = createHash("sha256").update(`tmux:${session}:${pane}`).digest("hex");
  const variant = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Undefined means the entire enumeration is untrusted, never an empty server. */
export function createTmuxPaneDiscovery(options: { readonly process: PaneDiscoveryProcess } = { process: productionEnumeratorProcess }): TmuxPaneDiscovery {
  return {
    async discover() {
      try {
        const { stdout } = await options.process.execute("tmux", ["list-panes", "-a", "-F", PANE_DISCOVERY_FORMAT]);
        const panes: DiscoveredPane[] = [];
        for (const line of stdout.split("\n")) {
          if (line === "") continue;
          const fields = line.split("|");
          const [pane, session, window] = fields;
          if (fields.length !== 3 || !/^%\d{1,20}$/.test(pane ?? "") || !/^\$\d{1,20}$/.test(session ?? "") || !/^@\d{1,20}$/.test(window ?? "")) return undefined;
          if (pane === undefined || session === undefined || window === undefined) return undefined;
          panes.push({ sessionId: deriveDiscoveredPaneSessionId(session, pane), target: { tmuxPaneId: pane, tmuxSession: session, tmuxWindow: window, ghosttyBundleId: "com.mitchellh.ghostty" } });
        }
        return panes;
      } catch {
        return undefined;
      }
    },
  };
}
