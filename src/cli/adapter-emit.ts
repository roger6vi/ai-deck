import { randomUUID } from "node:crypto";

import {
  ENDPOINT_CLIENT_OUTCOME,
  createEndpointClient,
  productionEndpointClientDependencies,
  type EndpointClient,
  type EndpointClientOutcome,
} from "../adapters/endpoint-client";
import { isLocalAgentStatusEvent } from "../core/events";
import type { LocalAgentStatusEvent } from "../core/types";
import { ADAPTER_EMIT_EXIT_CODE, isDirectCliInvocation } from "./adapter-emit-contract";

export { ADAPTER_EMIT_EXIT_CODE, isDirectCliInvocation } from "./adapter-emit-contract";
export type { AdapterEmitExitCode } from "./adapter-emit-contract";

type AdapterEmitExitCode = (typeof ADAPTER_EMIT_EXIT_CODE)[keyof typeof ADAPTER_EMIT_EXIT_CODE];

export const ADAPTER_EMIT_OUTCOME_MESSAGE = {
  EMITTED: "ai-deck: emitted",
  REJECTED: "ai-deck: rejected",
  UNAVAILABLE: "ai-deck: unavailable",
  TIMED_OUT: "ai-deck: timed-out",
  LOCAL_ERROR: "ai-deck: local-error",
} as const;

const USAGE = "usage: ai-deck-emit --source <codex|opencode|claude> --session-id <uuid> --lifecycle <started|running|completed|error|pane-disappeared> --pane-id %<N> --session $<N> [--event-id <uuid>] [--window @<N>] [--sequence <n>]";

export const ADAPTER_EMIT_PLUGIN_ROOT_MISSING_MESSAGE = "ai-deck: AI_DECK_PLUGIN_ROOT is not set";

const ALLOWED_FLAGS = new Set([
  "--source",
  "--session-id",
  "--event-id",
  "--lifecycle",
  "--pane-id",
  "--session",
  "--window",
  "--sequence",
]);
const REQUIRED_FLAGS = ["--source", "--session-id", "--lifecycle", "--pane-id", "--session"] as const;

export interface AdapterEmitClock {
  now(): number;
}

export interface AdapterEmitStream {
  write(text: string): void;
}

export interface AdapterEmitOptions {
  readonly argv: readonly string[];
  readonly clock: AdapterEmitClock;
  readonly client: EndpointClient;
  readonly stdout: AdapterEmitStream;
  readonly stderr: AdapterEmitStream;
}

export type AdapterEmitArgs =
  | { readonly kind: "event"; readonly event: LocalAgentStatusEvent }
  | { readonly kind: "invalid"; readonly reason: string };

function parseFlags(argv: readonly string[]): Map<string, string> | undefined {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) return undefined;
    if (!ALLOWED_FLAGS.has(flag)) return undefined;
    if (parsed.has(flag)) return undefined;
    parsed.set(flag, value);
  }
  return parsed;
}

function parseSequence(value: string | undefined): number | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : "invalid";
}

export function parseAdapterEmitArgs(argv: readonly string[], clock: AdapterEmitClock): AdapterEmitArgs {
  const flags = parseFlags(argv);
  if (flags === undefined) return { kind: "invalid", reason: USAGE };
  for (const required of REQUIRED_FLAGS) {
    if (!flags.has(required)) return { kind: "invalid", reason: USAGE };
  }
  const eventId = flags.get("--event-id") ?? randomUUID();
  const sequenceParsed = parseSequence(flags.get("--sequence"));
  if (sequenceParsed === "invalid") return { kind: "invalid", reason: USAGE };
  const target: Record<string, unknown> = {
    tmuxPaneId: flags.get("--pane-id"),
    tmuxSession: flags.get("--session"),
    ghosttyBundleId: "com.mitchellh.ghostty",
  };
  const window = flags.get("--window");
  if (window !== undefined) target.tmuxWindow = window;
  const candidate: Record<string, unknown> = {
    schemaVersion: 1,
    eventId,
    source: flags.get("--source"),
    sessionId: flags.get("--session-id"),
    timestamp: clock.now(),
    lifecycle: flags.get("--lifecycle"),
    target,
  };
  if (sequenceParsed !== undefined) candidate.sequence = sequenceParsed;
  if (!isLocalAgentStatusEvent(candidate)) return { kind: "invalid", reason: USAGE };
  return { kind: "event", event: candidate as unknown as LocalAgentStatusEvent };
}

function exitCodeFor(outcome: EndpointClientOutcome): AdapterEmitExitCode {
  if (outcome === ENDPOINT_CLIENT_OUTCOME.EMITTED) return ADAPTER_EMIT_EXIT_CODE.EMITTED;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.REJECTED) return ADAPTER_EMIT_EXIT_CODE.REJECTED;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.TIMED_OUT) return ADAPTER_EMIT_EXIT_CODE.TIMED_OUT;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE) return ADAPTER_EMIT_EXIT_CODE.UNAVAILABLE;
  return ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR;
}

function outcomeMessage(outcome: EndpointClientOutcome): string {
  if (outcome === ENDPOINT_CLIENT_OUTCOME.EMITTED) return ADAPTER_EMIT_OUTCOME_MESSAGE.EMITTED;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.REJECTED) return ADAPTER_EMIT_OUTCOME_MESSAGE.REJECTED;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.TIMED_OUT) return ADAPTER_EMIT_OUTCOME_MESSAGE.TIMED_OUT;
  if (outcome === ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE) return ADAPTER_EMIT_OUTCOME_MESSAGE.UNAVAILABLE;
  return ADAPTER_EMIT_OUTCOME_MESSAGE.LOCAL_ERROR;
}

export async function runAdapterEmit(options: AdapterEmitOptions): Promise<AdapterEmitExitCode> {
  const parsed = parseAdapterEmitArgs(options.argv, options.clock);
  if (parsed.kind === "invalid") {
    options.stderr.write(`${parsed.reason}\n`);
    return ADAPTER_EMIT_EXIT_CODE.REJECTED;
  }
  let outcome: EndpointClientOutcome;
  try {
    outcome = await options.client.emit(parsed.event);
  } catch {
    options.stderr.write(`${ADAPTER_EMIT_OUTCOME_MESSAGE.LOCAL_ERROR}\n`);
    return ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR;
  }
  options.stdout.write(`${outcomeMessage(outcome)}\n`);
  return exitCodeFor(outcome);
}

export function createProductionAdapterEmitClient(pluginRoot: string): EndpointClient {
  const getUid = typeof process.getuid === "function" ? process.getuid.bind(process) : (): number => -1;
  return createEndpointClient({
    pluginRoot,
    fs: productionEndpointClientDependencies.fs,
    http: productionEndpointClientDependencies.http,
    timer: productionEndpointClientDependencies.timer,
    ownUid: getUid(),
  });
}

export interface AdapterEmitMainOptions {
  readonly argv: readonly string[];
  readonly pluginRoot: string | undefined;
  readonly clock: AdapterEmitClock;
  readonly createClient: (pluginRoot: string) => EndpointClient;
  readonly stdout: AdapterEmitStream;
  readonly stderr: AdapterEmitStream;
}

export async function mainAdapterEmit(options: AdapterEmitMainOptions): Promise<AdapterEmitExitCode> {
  if (options.pluginRoot === undefined || options.pluginRoot.length === 0) {
    options.stderr.write(`${ADAPTER_EMIT_PLUGIN_ROOT_MISSING_MESSAGE}\n`);
    return ADAPTER_EMIT_EXIT_CODE.UNAVAILABLE;
  }
  return runAdapterEmit({
    argv: options.argv,
    clock: options.clock,
    client: options.createClient(options.pluginRoot),
    stdout: options.stdout,
    stderr: options.stderr,
  });
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  mainAdapterEmit({
    argv: process.argv.slice(2),
    pluginRoot: process.env.AI_DECK_PLUGIN_ROOT,
    clock: { now: () => Date.now() },
    createClient: createProductionAdapterEmitClient,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then(
    (code) => { process.exitCode = code; },
    () => { process.exitCode = ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR; },
  );
}
