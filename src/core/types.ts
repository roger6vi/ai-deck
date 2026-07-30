export const LOCAL_AGENT_TOOL = {
  CODEX: "codex",
  OPENCODE: "opencode",
  CLAUDE: "claude",
} as const;

export type LocalAgentTool = (typeof LOCAL_AGENT_TOOL)[keyof typeof LOCAL_AGENT_TOOL];

export const SESSION_STATUS = {
  STARTED: "started",
  RUNNING: "running",
  COMPLETED: "completed",
  ERROR: "error",
  PANE_DISAPPEARED: "pane-disappeared",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const LOCAL_AGENT_EVENT_KIND = {
  SESSION_STATUS: "session-status",
} as const;

export type LocalAgentEventKind = (typeof LOCAL_AGENT_EVENT_KIND)[keyof typeof LOCAL_AGENT_EVENT_KIND];

export const LOCAL_AGENT_EVENT_LIMITS = {
  SCHEMA_VERSION: 1,
  UUID_LENGTH: 36,
  MAX_TMUX_IDENTIFIER_DIGITS: 20,
  MAX_INTEGER: Number.MAX_SAFE_INTEGER,
} as const;

export interface LocalAgentSessionMetadata {
  readonly sessionId: string;
  readonly sequence?: number;
}

export interface LocalAgentTargetMetadata {
  readonly tmuxPaneId: string;
  readonly tmuxSession: string;
  readonly tmuxWindow?: string;
  readonly ghosttyBundleId: string;
}

export interface LocalAgentStatusEvent extends LocalAgentSessionMetadata {
  readonly schemaVersion: typeof LOCAL_AGENT_EVENT_LIMITS.SCHEMA_VERSION;
  readonly eventId: string;
  readonly source: LocalAgentTool;
  readonly timestamp: number;
  readonly lifecycle: SessionStatus;
  readonly target: LocalAgentTargetMetadata;
}
