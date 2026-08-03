import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTALLED_PLUGIN_ROOT = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins", "com.gentleman.ai-deck.sdPlugin");

export interface AdapterEnvironment {
  readonly pluginRoot: string | undefined;
  readonly paneId: string | undefined;
  readonly tmuxSession: string | undefined;
  readonly nodeBinary: string;
}

export function deriveAdapterSessionId(nativeSessionId: string): string {
  const hex = createHash("sha256").update(nativeSessionId, "utf8").digest("hex");
  const variant = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
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

export function resolveAdapterEnvironment(env: NodeJS.ProcessEnv = process.env): AdapterEnvironment {
  const paneId = env.TMUX_PANE;
  return {
    pluginRoot: resolvePluginRoot(),
    paneId,
    tmuxSession: paneId === undefined ? undefined : resolveTmuxSession(paneId),
    nodeBinary: env.AI_DECK_NODE ?? "node",
  };
}
