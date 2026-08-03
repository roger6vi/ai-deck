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

export function createOpenCodePluginHooks(environment: AdapterEnvironment): OpenCodePluginHooks {
  const tracker = new OpenCodeSessionTracker();
  const ready = environment.pluginRoot !== undefined && environment.paneId !== undefined && environment.tmuxSession !== undefined;
  return {
    async event({ event }) {
      if (!ready) return;
      const lifecycle = tracker.lifecycleFor(event);
      if (lifecycle === undefined) return;
      const pluginRoot = environment.pluginRoot;
      const paneId = environment.paneId;
      const tmuxSession = environment.tmuxSession;
      if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined) return;
      const sessionId = event.properties?.sessionID;
      if (sessionId === undefined) return;
      const child = spawn(environment.nodeBinary, [
        join(pluginRoot, "bin", "adapter-emit.js"),
        "--source", OPENCODE_ADAPTER_SOURCE,
        "--session-id", deriveAdapterSessionId(sessionId),
        "--lifecycle", lifecycle,
        "--pane-id", paneId,
        "--session", tmuxSession,
      ], { env: { ...process.env, AI_DECK_PLUGIN_ROOT: pluginRoot }, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
    },
  };
}

export const AiDeckOpenCodePlugin = async (): Promise<OpenCodePluginHooks> => createOpenCodePluginHooks(resolveAdapterEnvironment());

export default AiDeckOpenCodePlugin;
