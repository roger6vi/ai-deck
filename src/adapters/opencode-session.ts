import { createHash } from "node:crypto";

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

export function deriveAdapterSessionId(nativeSessionId: string): string {
  const hex = createHash("sha256").update(nativeSessionId, "utf8").digest("hex");
  const variant = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
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
