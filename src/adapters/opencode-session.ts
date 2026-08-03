import { SESSION_STATUS, type SessionStatus } from "../core/types";

export const OPENCODE_ADAPTER_SOURCE = "opencode" as const;

export interface OpenCodeEventProperties {
  readonly sessionID?: string;
  readonly status?: { readonly type: string };
}

export interface OpenCodeEvent {
  readonly type: string;
  readonly properties?: OpenCodeEventProperties;
}

export class OpenCodeSessionTracker {
  readonly #activeSessions = new Set<string>();

  lifecycleFor(event: OpenCodeEvent): SessionStatus | undefined {
    const sessionId = event.properties?.sessionID;
    if (sessionId === undefined) return undefined;
    if (event.type === "session.idle") {
      this.#activeSessions.delete(sessionId);
      return SESSION_STATUS.COMPLETED;
    }
    if (event.type === "session.error") {
      this.#activeSessions.delete(sessionId);
      return SESSION_STATUS.ERROR;
    }
    if (event.type !== "session.status") return undefined;
    const statusType = event.properties?.status?.type;
    if (statusType !== "busy" && statusType !== "retry") return undefined;
    if (this.#activeSessions.has(sessionId)) return SESSION_STATUS.RUNNING;
    this.#activeSessions.add(sessionId);
    return SESSION_STATUS.STARTED;
  }
}
