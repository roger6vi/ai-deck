import { spawnSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const ADAPTER_EMIT_EXIT_CODE = {
    LOCAL_ERROR: 5,
};
/**
 * Node reports `import.meta.url` for the real file, while `argv[1]` keeps the
 * path the caller typed. The Stream Deck plugin directory is commonly a
 * symlink, so both sides are compared through their real paths — otherwise the
 * bundled CLI is a silent no-op when it is invoked through the installed path.
 */
function realPathOf(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
function isDirectCliInvocation(moduleUrl, entryPath, cwd = process.cwd()) {
    if (entryPath === undefined)
        return false;
    return realPathOf(resolve(cwd, entryPath)) === realPathOf(resolve(fileURLToPath(moduleUrl)));
}

const INSTALLED_PLUGIN_ROOT = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins", "com.gentleman.ai-deck.sdPlugin");
function deriveAdapterSessionId(nativeSessionId) {
    const hex = createHash("sha256").update(nativeSessionId, "utf8").digest("hex");
    const variant = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
    const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
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
    COMPLETED: "completed",
    PANE_DISAPPEARED: "pane-disappeared",
};

const CLAUDE_ADAPTER_SOURCE = "claude";
/**
 * Claude Code runs every hook as a separate process, so no state survives
 * between invocations: a submitted prompt is always reported as `started`,
 * which the deck renders amber exactly like `running`.
 */
const HOOK_EVENT_LIFECYCLE = {
    UserPromptSubmit: SESSION_STATUS.STARTED,
    Stop: SESSION_STATUS.COMPLETED,
    SessionEnd: SESSION_STATUS.PANE_DISAPPEARED,
};
/** The hook events the bundled Claude Code plugin has to register. */
Object.freeze(Object.keys(HOOK_EVENT_LIFECYCLE));
function parseClaudeHookPayload(raw) {
    let candidate;
    try {
        candidate = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
        return undefined;
    const { hook_event_name: hookEventName, session_id: sessionId } = candidate;
    if (typeof hookEventName !== "string" || typeof sessionId !== "string")
        return undefined;
    if (hookEventName.length === 0 || sessionId.length === 0)
        return undefined;
    return { hookEventName, sessionId };
}
function lifecycleForClaudeHook(payload) {
    return HOOK_EVENT_LIFECYCLE[payload.hookEventName];
}

/**
 * A hook exit code other than zero is a control signal for Claude Code — on
 * `UserPromptSubmit` it discards the prompt. Session status is never worth
 * breaking the session over, so the hook always succeeds.
 */
const CLAUDE_HOOK_EXIT_CODE = 0;
const STDIN_BYTE_LIMIT = 64 * 1024;
function buildClaudeHookArgv(payload, environment) {
    const lifecycle = lifecycleForClaudeHook(payload);
    if (lifecycle === undefined)
        return undefined;
    const { pluginRoot, paneId, tmuxSession } = environment;
    if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined)
        return undefined;
    return [
        "--source", CLAUDE_ADAPTER_SOURCE,
        "--session-id", deriveAdapterSessionId(payload.sessionId),
        "--lifecycle", lifecycle,
        "--pane-id", paneId,
        "--session", tmuxSession,
    ];
}
async function runClaudeHook(options) {
    const payload = parseClaudeHookPayload(options.input);
    if (payload === undefined)
        return CLAUDE_HOOK_EXIT_CODE;
    const argv = buildClaudeHookArgv(payload, options.environment);
    const pluginRoot = options.environment.pluginRoot;
    if (argv === undefined || pluginRoot === undefined)
        return CLAUDE_HOOK_EXIT_CODE;
    try {
        await options.emit({ argv, pluginRoot });
    }
    catch {
        return CLAUDE_HOOK_EXIT_CODE;
    }
    return CLAUDE_HOOK_EXIT_CODE;
}
function createClaudeHookEmit(environment) {
    return async ({ argv, pluginRoot }) => new Promise((resolveCode) => {
        const child = spawn(environment.nodeBinary, [join(pluginRoot, "bin", "adapter-emit.js"), ...argv], {
            env: { ...process.env, AI_DECK_PLUGIN_ROOT: pluginRoot },
            stdio: "ignore",
        });
        child.on("error", () => resolveCode(ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR));
        child.on("close", (code) => resolveCode(code ?? ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR));
    });
}
async function readHookInput() {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        const buffer = Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > STDIN_BYTE_LIMIT)
            return "";
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
}
if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
    const environment = resolveAdapterEnvironment();
    readHookInput()
        .then((input) => runClaudeHook({ input, environment, emit: createClaudeHookEmit(environment) }))
        .then(() => { process.exitCode = CLAUDE_HOOK_EXIT_CODE; }, () => { process.exitCode = CLAUDE_HOOK_EXIT_CODE; });
}

export { CLAUDE_HOOK_EXIT_CODE, buildClaudeHookArgv, createClaudeHookEmit, runClaudeHook };
