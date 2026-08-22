import { spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

const INSTALLED_PLUGIN_ROOT = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins", "io.github.roger6vi.ai-deck.sdPlugin");
function deriveAdapterSessionId(nativeSessionId) {
    const hex = createHash("sha256").update(nativeSessionId, "utf8").digest("hex");
    const variant = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
    const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}
/**
 * OpenCode gets one deck entry per tmux pane, not per native session: a root
 * and every child/subagent it spawns share the pane they run in. The identity
 * hashes only tmux's own internal identifiers (never a title or window name),
 * and the tmux session id scopes the pane id so two tmux servers cannot
 * collide on the same `%N`.
 */
function deriveOpenCodePaneSessionId(tmuxSession, tmuxPaneId) {
    return deriveAdapterSessionId(`opencode:${tmuxSession}:${tmuxPaneId}`);
}
function resolvePluginRoot() {
    const candidate = process.env.AI_DECK_PLUGIN_ROOT ?? INSTALLED_PLUGIN_ROOT;
    try {
        return realpathSync(candidate);
    }
    catch {
        return undefined;
    }
}
function resolveTmuxSession(paneId) {
    try {
        const result = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{session_id}"], { encoding: "utf8", timeout: 1000 });
        if (result.status !== 0)
            return undefined;
        const session = (result.stdout ?? "").trim();
        return /^\$\d{1,20}$/.test(session) ? session : undefined;
    }
    catch {
        return undefined;
    }
}
function resolveAdapterEnvironment(env = process.env) {
    const paneId = env.TMUX_PANE;
    return {
        pluginRoot: resolvePluginRoot(),
        paneId,
        tmuxSession: paneId === undefined ? undefined : resolveTmuxSession(paneId),
        nodeBinary: env.AI_DECK_NODE ?? "node",
    };
}

const SESSION_STATUS = {
    STARTED: "started",
    RUNNING: "running",
    COMPLETED: "completed",
    ERROR: "error"};

const OPENCODE_ADAPTER_SOURCE = "opencode";
/**
 * Aggregates every native OpenCode session of one pane into a single pane
 * lifecycle. A root and its child/subagent sessions all live on the same
 * pane, so the pane stays running while ANY tracked native session is active
 * and only completes (or errors) once none remain. One child finishing or
 * failing must never complete or corrupt the pane state on its own.
 */
class OpenCodeSessionTracker {
    #activeSessions = new Set();
    lifecycleFor(event) {
        const sessionId = event.properties?.sessionID;
        if (sessionId === undefined)
            return undefined;
        if (event.type === "session.idle") {
            this.#activeSessions.delete(sessionId);
            return this.#activeSessions.size === 0 ? SESSION_STATUS.COMPLETED : SESSION_STATUS.RUNNING;
        }
        if (event.type === "session.error") {
            this.#activeSessions.delete(sessionId);
            return this.#activeSessions.size === 0 ? SESSION_STATUS.ERROR : SESSION_STATUS.RUNNING;
        }
        if (event.type !== "session.status")
            return undefined;
        const statusType = event.properties?.status?.type;
        if (statusType !== "busy" && statusType !== "retry")
            return undefined;
        const wasIdle = this.#activeSessions.size === 0;
        this.#activeSessions.add(sessionId);
        return wasIdle ? SESSION_STATUS.STARTED : SESSION_STATUS.RUNNING;
    }
}

const productionSpawn = (command, args, options) => spawn(command, [...args], options);
function createOpenCodePluginHooks(environment, spawnProcess = productionSpawn) {
    /**
     * The emit CLI stamps its timestamp inside the spawned child, and OpenCode
     * ends a turn with `busy` and `idle` milliseconds apart. Node startup jitter
     * alone can invert those two stamps, and the plugin then discards the later
     * lifecycle as stale — leaving the key amber forever. A pane-level counter
     * gives every native session of the pane one ordering that does not depend
     * on process scheduling. After an adapter restart the counter resets, and
     * the fresh event timestamp is what lets the deck advance again.
     */
    let sequence = 0;
    const tracker = new OpenCodeSessionTracker();
    const ready = environment.pluginRoot !== undefined && environment.paneId !== undefined && environment.tmuxSession !== undefined;
    return {
        async event({ event }) {
            if (!ready)
                return;
            const observedAt = Date.now();
            const lifecycle = tracker.lifecycleFor(event);
            if (lifecycle === undefined)
                return;
            const pluginRoot = environment.pluginRoot;
            const paneId = environment.paneId;
            const tmuxSession = environment.tmuxSession;
            if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined)
                return;
            sequence += 1;
            const child = spawnProcess(environment.nodeBinary, [
                join(pluginRoot, "bin", "adapter-emit.js"),
                "--source", OPENCODE_ADAPTER_SOURCE,
                "--session-id", deriveOpenCodePaneSessionId(tmuxSession, paneId),
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
const AiDeckOpenCodePlugin = async () => createOpenCodePluginHooks(resolveAdapterEnvironment());

export { AiDeckOpenCodePlugin, createOpenCodePluginHooks, AiDeckOpenCodePlugin as default };
