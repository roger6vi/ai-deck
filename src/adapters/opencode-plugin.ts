import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  deriveAdapterSessionId,
  OpenCodeSessionTracker,
  OPENCODE_ADAPTER_SOURCE,
  type OpenCodeEvent,
} from "./opencode-session";

const INSTALLED_PLUGIN_ROOT = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins", "com.gentleman.ai-deck.sdPlugin");

export interface OpenCodePluginHooks {
  readonly event: (input: { readonly event: OpenCodeEvent }) => Promise<void>;
}

export interface OpenCodeAdapterEnvironment {
  readonly pluginRoot: string | undefined;
  readonly paneId: string | undefined;
  readonly tmuxSession: string | undefined;
  readonly nodeBinary: string;
}

function resolvePluginRoot(): string | undefined {
  const candidate = process.env.AI_DECK_PLUGIN_ROOT ?? INSTALLED_PLUGIN_ROOT;
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}

function resolveTmuxSession(paneId: string): string | undefined {
  try {
    const result = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{session_id}"], { encoding: "utf8", timeout: 1000 });
    if (result.status !== 0) return undefined;
    const session = (result.stdout ?? "").trim();
    return /^\$\d{1,20}$/.test(session) ? session : undefined;
  } catch {
    return undefined;
  }
}

export function resolveOpenCodeAdapterEnvironment(env: NodeJS.ProcessEnv = process.env): OpenCodeAdapterEnvironment {
  const paneId = env.TMUX_PANE;
  return {
    pluginRoot: resolvePluginRoot(),
    paneId,
    tmuxSession: paneId === undefined ? undefined : resolveTmuxSession(paneId),
    nodeBinary: env.AI_DECK_NODE ?? "node",
  };
}

export function createOpenCodePluginHooks(environment: OpenCodeAdapterEnvironment): OpenCodePluginHooks {
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

export const AiDeckOpenCodePlugin = async (): Promise<OpenCodePluginHooks> => createOpenCodePluginHooks(resolveOpenCodeAdapterEnvironment());

export default AiDeckOpenCodePlugin;
