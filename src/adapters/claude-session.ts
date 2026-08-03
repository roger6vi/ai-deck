import { SESSION_STATUS, type SessionStatus } from "../core/types";

export const CLAUDE_ADAPTER_SOURCE = "claude" as const;

export interface ClaudeHookPayload {
  readonly hookEventName: string;
  readonly sessionId: string;
  readonly message?: string;
}

const NOTIFICATION_EVENT = "Notification";

/**
 * Claude Code raises `Notification` both when it is blocked on a permission
 * prompt and when it has simply been idle. Only the first deserves a key: the
 * idle one would re-blue a key the user already acknowledged.
 */
const IDLE_NOTIFICATION_MARKER = "waiting for your input";

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

/** The hook events the bundled Claude Code plugin has to register. */
export const CLAUDE_HOOK_EVENTS: readonly string[] = Object.freeze([...Object.keys(HOOK_EVENT_LIFECYCLE), NOTIFICATION_EVENT]);

export function parseClaudeHookPayload(raw: string): ClaudeHookPayload | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return undefined;
  const { hook_event_name: hookEventName, session_id: sessionId, message } = candidate as Record<string, unknown>;
  if (typeof hookEventName !== "string" || typeof sessionId !== "string") return undefined;
  if (hookEventName.length === 0 || sessionId.length === 0) return undefined;
  return { hookEventName, sessionId, ...(typeof message === "string" ? { message } : {}) };
}

export function lifecycleForClaudeHook(payload: ClaudeHookPayload): SessionStatus | undefined {
  if (payload.hookEventName === NOTIFICATION_EVENT) {
    // An unrecognised notification still means Claude spoke up: prefer telling
    // the user over staying dark.
    return payload.message?.includes(IDLE_NOTIFICATION_MARKER) === true ? undefined : SESSION_STATUS.COMPLETED;
  }
  return HOOK_EVENT_LIFECYCLE[payload.hookEventName];
}
