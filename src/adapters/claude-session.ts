import { SESSION_STATUS, type SessionStatus } from "../core/types";

export const CLAUDE_ADAPTER_SOURCE = "claude" as const;

export interface ClaudeHookPayload {
  readonly hookEventName: string;
  readonly sessionId: string;
}

/**
 * Claude Code runs every hook as a separate process, so no state survives
 * between invocations: a submitted prompt is always reported as `started`,
 * which the deck renders amber exactly like `running`.
 */
const HOOK_EVENT_LIFECYCLE: Readonly<Record<string, SessionStatus>> = {
  UserPromptSubmit: SESSION_STATUS.STARTED,
  Stop: SESSION_STATUS.COMPLETED,
  SessionEnd: SESSION_STATUS.PANE_DISAPPEARED,
};

export function parseClaudeHookPayload(raw: string): ClaudeHookPayload | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return undefined;
  const { hook_event_name: hookEventName, session_id: sessionId } = candidate as Record<string, unknown>;
  if (typeof hookEventName !== "string" || typeof sessionId !== "string") return undefined;
  if (hookEventName.length === 0 || sessionId.length === 0) return undefined;
  return { hookEventName, sessionId };
}

export function lifecycleForClaudeHook(payload: ClaudeHookPayload): SessionStatus | undefined {
  return HOOK_EVENT_LIFECYCLE[payload.hookEventName];
}
