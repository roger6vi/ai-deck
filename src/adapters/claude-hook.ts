import { spawn } from "node:child_process";
import { join } from "node:path";

import { ADAPTER_EMIT_EXIT_CODE, isDirectCliInvocation } from "../cli/adapter-emit-contract";
import {
  deriveAdapterSessionId,
  resolveAdapterEnvironment,
  type AdapterEnvironment,
} from "./adapter-environment";
import {
  CLAUDE_ADAPTER_SOURCE,
  lifecycleForClaudeHook,
  parseClaudeHookPayload,
  type ClaudeHookPayload,
} from "./claude-session";

/**
 * A hook exit code other than zero is a control signal for Claude Code — on
 * `UserPromptSubmit` it discards the prompt. Session status is never worth
 * breaking the session over, so the hook always succeeds.
 */
export const CLAUDE_HOOK_EXIT_CODE = 0;

const STDIN_BYTE_LIMIT = 64 * 1024;

export interface ClaudeHookEmitRequest {
  readonly argv: readonly string[];
  readonly pluginRoot: string;
}

export type ClaudeHookEmit = (request: ClaudeHookEmitRequest) => Promise<number>;

export interface ClaudeHookOptions {
  readonly input: string;
  readonly environment: AdapterEnvironment;
  readonly emit: ClaudeHookEmit;
}

export function buildClaudeHookArgv(payload: ClaudeHookPayload, environment: AdapterEnvironment): readonly string[] | undefined {
  const lifecycle = lifecycleForClaudeHook(payload);
  if (lifecycle === undefined) return undefined;
  const { pluginRoot, paneId, tmuxSession } = environment;
  if (pluginRoot === undefined || paneId === undefined || tmuxSession === undefined) return undefined;
  return [
    "--source", CLAUDE_ADAPTER_SOURCE,
    "--session-id", deriveAdapterSessionId(payload.sessionId),
    "--lifecycle", lifecycle,
    "--pane-id", paneId,
    "--session", tmuxSession,
  ];
}

export async function runClaudeHook(options: ClaudeHookOptions): Promise<typeof CLAUDE_HOOK_EXIT_CODE> {
  const payload = parseClaudeHookPayload(options.input);
  if (payload === undefined) return CLAUDE_HOOK_EXIT_CODE;
  const argv = buildClaudeHookArgv(payload, options.environment);
  const pluginRoot = options.environment.pluginRoot;
  if (argv === undefined || pluginRoot === undefined) return CLAUDE_HOOK_EXIT_CODE;
  try {
    await options.emit({ argv, pluginRoot });
  } catch {
    return CLAUDE_HOOK_EXIT_CODE;
  }
  return CLAUDE_HOOK_EXIT_CODE;
}

export function createClaudeHookEmit(environment: AdapterEnvironment): ClaudeHookEmit {
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
    .then((input) => runClaudeHook({ input, environment, emit: createClaudeHookEmit(environment) }))
    .then(
      () => { process.exitCode = CLAUDE_HOOK_EXIT_CODE; },
      () => { process.exitCode = CLAUDE_HOOK_EXIT_CODE; },
    );
}
