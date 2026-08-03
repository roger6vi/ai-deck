import {
  LOCAL_AGENT_EVENT_LIMITS,
  LOCAL_AGENT_TOOL,
  SESSION_STATUS,
  type LocalAgentStatusEvent,
  type LocalAgentTargetMetadata,
  type LocalAgentTool,
  type SessionStatus,
} from "./types";

const EVENT_FIELDS = {
  SCHEMA_VERSION: "schemaVersion",
  EVENT_ID: "eventId",
  SOURCE: "source",
  SESSION_ID: "sessionId",
  SEQUENCE: "sequence",
  TIMESTAMP: "timestamp",
  LIFECYCLE: "lifecycle",
  TARGET: "target",
} as const;
const TARGET_FIELDS = {
  TMUX_PANE_ID: "tmuxPaneId",
  TMUX_SESSION: "tmuxSession",
  TMUX_WINDOW: "tmuxWindow",
  GHOSTTY_BUNDLE_ID: "ghosttyBundleId",
} as const;

export const PROHIBITED_CONTENT_FIELD = {
  PROMPT: "prompt",
  TRANSCRIPT: "transcript",
  MESSAGES: "messages",
  ASSISTANT_OUTPUT: "assistantOutput",
  USER_OUTPUT: "userOutput",
  TOOL_OUTPUT: "toolOutput",
  COMMAND: "command",
  COMMAND_LINE: "commandLine",
  FILE_PATH: "filePath",
  FILE_CONTENTS: "fileContents",
  SECRET: "secret",
  TOKEN: "token",
  CREDENTIALS: "credentials",
  RAW: "raw",
  PAYLOAD: "payload",
  OUTPUT: "output",
} as const;

export type ProhibitedContentField =
  (typeof PROHIBITED_CONTENT_FIELD)[keyof typeof PROHIBITED_CONTENT_FIELD];

const INVALID_EVENT_MESSAGE = "Invalid local agent status event.";
// Accept lowercase RFC 4122 version 4 UUIDs only; adapters normalize or hash native IDs.
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TMUX_IDENTIFIER_QUANTIFIER = `{1,${LOCAL_AGENT_EVENT_LIMITS.MAX_TMUX_IDENTIFIER_DIGITS}}`;
const TMUX_SESSION_PATTERN = new RegExp(`^\\$\\d${TMUX_IDENTIFIER_QUANTIFIER}$`);
const TMUX_WINDOW_PATTERN = new RegExp(`^@\\d${TMUX_IDENTIFIER_QUANTIFIER}$`);
const TMUX_PANE_PATTERN = new RegExp(`^%\\d${TMUX_IDENTIFIER_QUANTIFIER}$`);
// The approved target has no display name: only Ghostty's stable bundle identifier.
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const EVENT_REQUIRED_FIELDS = Object.values(EVENT_FIELDS).filter(
  (field) => field !== EVENT_FIELDS.SEQUENCE,
);
const TARGET_REQUIRED_FIELDS = Object.values(TARGET_FIELDS).filter(
  (field) => field !== TARGET_FIELDS.TMUX_WINDOW,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyFields(record: Record<string, unknown>, allowedFields: readonly string[]): boolean {
  return Reflect.ownKeys(record).every((field) => {
    if (typeof field !== "string" || !allowedFields.includes(field)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function hasFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(record, field));
}

function field(record: Record<string, unknown>, name: string): unknown {
  return Object.getOwnPropertyDescriptor(record, name)?.value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === LOCAL_AGENT_EVENT_LIMITS.UUID_LENGTH &&
    UUID_V4_PATTERN.test(value)
  );
}

function isTargetIdentifier(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= LOCAL_AGENT_EVENT_LIMITS.MAX_INTEGER
  );
}

function cloneToFrozenNullPrototype<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, value)) as Readonly<T>;
}

function isTool(value: unknown): value is LocalAgentTool {
  return typeof value === "string" && Object.values(LOCAL_AGENT_TOOL).includes(value as LocalAgentTool);
}

function isStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && Object.values(SESSION_STATUS).includes(value as SessionStatus);
}

function parseTarget(value: unknown): LocalAgentTargetMetadata | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, Object.values(TARGET_FIELDS)) ||
    !hasFields(value, TARGET_REQUIRED_FIELDS)
  ) return undefined;
  const tmuxPaneId = field(value, TARGET_FIELDS.TMUX_PANE_ID);
  const tmuxSession = field(value, TARGET_FIELDS.TMUX_SESSION);
  const ghosttyBundleId = field(value, TARGET_FIELDS.GHOSTTY_BUNDLE_ID);
  const tmuxWindow = field(value, TARGET_FIELDS.TMUX_WINDOW);
  if (
    !isTargetIdentifier(tmuxPaneId, TMUX_PANE_PATTERN) ||
    !isTargetIdentifier(tmuxSession, TMUX_SESSION_PATTERN) ||
    ghosttyBundleId !== GHOSTTY_BUNDLE_ID
  ) return undefined;
  const target = { tmuxPaneId, tmuxSession, ghosttyBundleId };
  if (Object.hasOwn(value, TARGET_FIELDS.TMUX_WINDOW)) {
    if (!isTargetIdentifier(tmuxWindow, TMUX_WINDOW_PATTERN)) return undefined;
    return cloneToFrozenNullPrototype({ ...target, tmuxWindow });
  }
  return cloneToFrozenNullPrototype(target);
}

function parseEvent(value: unknown): LocalAgentStatusEvent | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, Object.values(EVENT_FIELDS)) ||
    !hasFields(value, EVENT_REQUIRED_FIELDS)
  ) return undefined;
  const schemaVersion = field(value, EVENT_FIELDS.SCHEMA_VERSION);
  const eventId = field(value, EVENT_FIELDS.EVENT_ID);
  const source = field(value, EVENT_FIELDS.SOURCE);
  const sessionId = field(value, EVENT_FIELDS.SESSION_ID);
  const sequence = field(value, EVENT_FIELDS.SEQUENCE);
  const timestamp = field(value, EVENT_FIELDS.TIMESTAMP);
  const lifecycle = field(value, EVENT_FIELDS.LIFECYCLE);
  const target = parseTarget(field(value, EVENT_FIELDS.TARGET));
  if (
    schemaVersion !== LOCAL_AGENT_EVENT_LIMITS.SCHEMA_VERSION ||
    !isUuid(eventId) ||
    !isTool(source) ||
    !isUuid(sessionId) ||
    !isNonnegativeInteger(timestamp) ||
    !isStatus(lifecycle) ||
    target === undefined
  ) return undefined;
  const event = { schemaVersion, eventId, source, sessionId, timestamp, lifecycle, target };
  if (Object.hasOwn(value, EVENT_FIELDS.SEQUENCE)) {
    if (!isNonnegativeInteger(sequence)) return undefined;
    return cloneToFrozenNullPrototype({ ...event, sequence });
  }
  return cloneToFrozenNullPrototype(event);
}

export function parseLocalAgentStatusEvent(value: unknown): LocalAgentStatusEvent {
  try {
    const event = parseEvent(value);
    if (event !== undefined) return event;
  } catch {
    // Never expose untrusted input through parsing errors.
  }
  throw new Error(INVALID_EVENT_MESSAGE);
}

export function isLocalAgentStatusEvent(value: unknown): value is LocalAgentStatusEvent {
  try {
    parseLocalAgentStatusEvent(value);
    return true;
  } catch {
    return false;
  }
}
