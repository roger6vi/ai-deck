import { spawn } from "node:child_process";
import { join } from "node:path";

import { ADAPTER_EMIT_EXIT_CODE, isDirectCliInvocation } from "../cli/adapter-emit-contract";
import type { SessionStatus } from "../core/types";
import {
  deriveAdapterSessionId,
  resolveAdapterEnvironment,
  type AdapterEnvironment,
} from "./adapter-environment";
import { codexLifecycleFor, CODEX_ADAPTER_SOURCE, parseCodexHookPayload } from "./codex-session";

/**
 * As with Claude Code, a non-zero hook exit code is a control signal for the
 * agent. Session status is never worth interfering with a turn, so the hook
 * always succeeds.
 */
export const CODEX_HOOK_EXIT_CODE = 0;

const STDIN_BYTE_LIMIT = 64 * 1024;
const LIFECYCLE_FLAG = "--lifecycle";

export interface CodexHookEmitRequest {
  readonly argv: readonly string[];
  readonly pluginRoot: string;
}

export type CodexHookEmit = (request: CodexHookEmitRequest) => Promise<number>;

export interface CodexHookOptions {
  readonly input: string;
  readonly argv: readonly string[];
  readonly environment: AdapterEnvironment;
  readonly emit: CodexHookEmit;
}

export function buildCodexHookArgv(sessionId: string, lifecycle: SessionStatus, environment: AdapterEnvironment): readonly string[] | undefined {
  const { pluginRoot, paneId, tmuxSession } = environment;
  if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined) return undefined;
  return [
    "--source", CODEX_ADAPTER_SOURCE,
    "--session-id", deriveAdapterSessionId(sessionId),
    "--lifecycle", lifecycle,
    "--pane-id", paneId,
    "--session", tmuxSession,
  ];
}

function lifecycleFromArgv(argv: readonly string[]): SessionStatus | undefined {
  const index = argv.indexOf(LIFECYCLE_FLAG);
  return index < 0 ? undefined : codexLifecycleFor(argv[index + 1]);
}

export async function runCodexHook(options: CodexHookOptions): Promise<typeof CODEX_HOOK_EXIT_CODE> {
  const lifecycle = lifecycleFromArgv(options.argv);
  const payload = parseCodexHookPayload(options.input);
  if (lifecycle === undefined || payload === undefined) return CODEX_HOOK_EXIT_CODE;
  const argv = buildCodexHookArgv(payload.sessionId, lifecycle, options.environment);
  const pluginRoot = options.environment.pluginRoot;
  if (argv === undefined || pluginRoot === undefined) return CODEX_HOOK_EXIT_CODE;
  try {
    await options.emit({ argv, pluginRoot });
  } catch {
    return CODEX_HOOK_EXIT_CODE;
  }
  return CODEX_HOOK_EXIT_CODE;
}

export function createCodexHookEmit(environment: AdapterEnvironment): CodexHookEmit {
  return async ({ argv, pluginRoot }) => new Promise<number>((resolveCode) => {
    const child = spawn(environment.nodeBinary, [join(pluginRoot, "bin", "adapter-emit.js"), ...argv], {
      env: { ...process.env, AI_DECK_PLUGIN_ROOT: pluginRoot },
      stdio: "ignore",
    });
    child.on("error", () => resolveCode(ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR));
    child.on("close", (code) => resolveCode(code ?? ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR));
  });
}

async function readHookInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > STDIN_BYTE_LIMIT) return "";
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  const environment = resolveAdapterEnvironment();
  readHookInput()
    .then((input) => runCodexHook({ input, argv: process.argv.slice(2), environment, emit: createCodexHookEmit(environment) }))
    .then(
      () => { process.exitCode = CODEX_HOOK_EXIT_CODE; },
      () => { process.exitCode = CODEX_HOOK_EXIT_CODE; },
    );
}
