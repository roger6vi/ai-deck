import { SESSION_STATUS, type SessionStatus } from "../core/types";

export const CODEX_ADAPTER_SOURCE = "codex" as const;

export interface CodexHookPayload {
  readonly sessionId: string;
}

/**
 * Codex names every lifecycle event separately, so the hook entry declares its
 * own lifecycle instead of the script guessing one from the payload. The
 * allowlist keeps a hand-edited hooks file from inventing a lifecycle.
 */
export const CODEX_HOOK_LIFECYCLES: readonly SessionStatus[] = Object.freeze([
  SESSION_STATUS.STARTED,
  SESSION_STATUS.COMPLETED,
  SESSION_STATUS.PANE_DISAPPEARED,
]);

export function parseCodexHookPayload(raw: string): CodexHookPayload | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return undefined;
  const { session_id: sessionId } = candidate as Record<string, unknown>;
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  return { sessionId };
}

export function codexLifecycleFor(lifecycle: string | undefined): SessionStatus | undefined {
  return CODEX_HOOK_LIFECYCLES.find((allowed) => allowed === lifecycle);
}
