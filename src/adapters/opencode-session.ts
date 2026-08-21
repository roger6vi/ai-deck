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

/**
 * Aggregates every native OpenCode session of one pane into a single pane
 * lifecycle. A root and its child/subagent sessions all live on the same
 * pane, so the pane stays running while ANY tracked native session is active
 * and only completes (or errors) once none remain. One child finishing or
 * failing must never complete or corrupt the pane state on its own.
 */
export class OpenCodeSessionTracker {
  readonly #activeSessions = new Set<string>();

  lifecycleFor(event: OpenCodeEvent): SessionStatus | undefined {
    const sessionId = event.properties?.sessionID;
    if (sessionId === undefined) return undefined;
    if (event.type === "session.idle") {
      this.#activeSessions.delete(sessionId);
      return this.#activeSessions.size === 0 ? SESSION_STATUS.COMPLETED : SESSION_STATUS.RUNNING;
    }
    if (event.type === "session.error") {
      this.#activeSessions.delete(sessionId);
      return this.#activeSessions.size === 0 ? SESSION_STATUS.ERROR : SESSION_STATUS.RUNNING;
    }
    if (event.type !== "session.status") return undefined;
    const statusType = event.properties?.status?.type;
    if (statusType !== "busy" && statusType !== "retry") return undefined;
    const wasIdle = this.#activeSessions.size === 0;
    this.#activeSessions.add(sessionId);
    return wasIdle ? SESSION_STATUS.STARTED : SESSION_STATUS.RUNNING;
  }
}
