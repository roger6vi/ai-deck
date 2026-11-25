import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

interface PiHooks {
  on(name: "agent_start" | "agent_settled", handler: () => Promise<void>): unknown;
}

const DEFAULT_PLUGIN_ROOT = resolve(homedir(), "Library/Application Support/com.elgato.StreamDeck/Plugins/roger6vi.ai-deck.sdPlugin");

export function registerPiAdapter(pi: PiHooks, env: NodeJS.ProcessEnv): void {
  const pane = env.TMUX_PANE;
  if (!pane || !/^%\d{1,20}$/.test(pane)) return;
  const pluginRoot = resolve(env.AI_DECK_PLUGIN_ROOT || DEFAULT_PLUGIN_ROOT);
  const run = (command: string, args: string[], childEnv: NodeJS.ProcessEnv): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(command, args, {
        encoding: "utf8", env: childEnv, timeout: 500, killSignal: "SIGKILL", maxBuffer: 4096,
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });

  let sequence = 0;
  let timestamp = 0;
  let pending = Promise.resolve();
  const emit = (lifecycle: "started" | "completed"): Promise<void> => {
    timestamp = Math.max(Date.now(), timestamp);
    const ordering = ["--timestamp", String(timestamp), "--sequence", String(++sequence)];
    pending = pending.then(async () => {
      const session = (await run("tmux", ["display-message", "-t", pane, "-p", "#{session_id}"], {
        PATH: env.PATH, HOME: env.HOME, TMUX: env.TMUX,
      })).trim();
      if (!/^\$\d{1,20}$/.test(session)) return;
      // A key represents the tmux pane, not an individual Pi conversation or retry.
      const hex = createHash("sha256").update(`pi:${session}:${pane}`).digest("hex");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      await run(env.AI_DECK_NODE || "node", [
        resolve(pluginRoot, "bin/adapter-emit.js"),
        "--source", "pi", "--session-id", id, "--lifecycle", lifecycle,
        "--pane-id", pane, "--session", session, ...ordering,
      ], { PATH: env.PATH, HOME: env.HOME, AI_DECK_PLUGIN_ROOT: pluginRoot });
    }).catch(() => { /* Stream Deck must never stop a Gentle Shell run. */ });
    return pending;
  };

  pi.on("agent_start", () => emit("started"));
  // A low-level agent_end can still be followed by retries or queued work.
  pi.on("agent_settled", () => emit("completed"));
}

export default function aiDeck(pi: PiHooks): void {
  registerPiAdapter(pi, process.env);
}
