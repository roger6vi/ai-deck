import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  deriveAdapterSessionId,
  resolveAdapterEnvironment,
  type AdapterEnvironment,
} from "./adapter-environment";
import {
  OpenCodeSessionTracker,
  OPENCODE_ADAPTER_SOURCE,
  type OpenCodeEvent,
} from "./opencode-session";

export interface OpenCodePluginHooks {
  readonly event: (input: { readonly event: OpenCodeEvent }) => Promise<void>;
}

export interface OpenCodeChild {
  on(event: "error", listener: () => void): void;
  unref(): void;
}

export type OpenCodeSpawn = (command: string, args: readonly string[], options: { readonly env: NodeJS.ProcessEnv; readonly stdio: "ignore" }) => OpenCodeChild;

const productionSpawn: OpenCodeSpawn = (command, args, options) => spawn(command, [...args], options);

export function createOpenCodePluginHooks(environment: AdapterEnvironment, spawnProcess: OpenCodeSpawn = productionSpawn): OpenCodePluginHooks {
  /**
   * The emit CLI stamps its timestamp inside the spawned child, and OpenCode
   * ends a turn with `busy` and `idle` milliseconds apart. Node startup jitter
   * alone can invert those two stamps, and the plugin then discards the later
   * lifecycle as stale — leaving the key amber forever. A per-session counter
   * gives it an ordering that does not depend on process scheduling.
   */
  const sequences = new Map<string, number>();
  const tracker = new OpenCodeSessionTracker();
  const ready = environment.pluginRoot !== undefined && environment.paneId !== undefined && environment.tmuxSession !== undefined;
  return {
    async event({ event }) {
      if (!ready) return;
      const observedAt = Date.now();
      const lifecycle = tracker.lifecycleFor(event);
      if (lifecycle === undefined) return;
      const pluginRoot = environment.pluginRoot;
      const paneId = environment.paneId;
      const tmuxSession = environment.tmuxSession;
      if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined) return;
      const sessionId = event.properties?.sessionID;
      if (sessionId === undefined) return;
      const sequence = (sequences.get(sessionId) ?? 0) + 1;
      sequences.set(sessionId, sequence);
      const child = spawnProcess(environment.nodeBinary, [
        join(pluginRoot, "bin", "adapter-emit.js"),
        "--source", OPENCODE_ADAPTER_SOURCE,
        "--session-id", deriveAdapterSessionId(sessionId),
        "--lifecycle", lifecycle,
        "--pane-id", paneId,
        "--session", tmuxSession,
        "--sequence", String(sequence),
        "--timestamp", String(observedAt),
      ], { env: { ...process.env, AI_DECK_PLUGIN_ROOT: pluginRoot }, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
    },
  };
}

export const AiDeckOpenCodePlugin = async (): Promise<OpenCodePluginHooks> => createOpenCodePluginHooks(resolveAdapterEnvironment());

export default AiDeckOpenCodePlugin;
