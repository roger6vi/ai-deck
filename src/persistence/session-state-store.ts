import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createSessionState, SESSION_REDUCER_LIMITS, type RetiredSession, type SessionSlot, type SessionState } from "../core/reducer";
import { LOCAL_AGENT_TOOL, SESSION_STATUS, type LocalAgentStatusEvent, type LocalAgentTargetMetadata, type LocalAgentTool, type SessionStatus } from "../core/types";

export const SESSION_STATE_STORE_SCHEMA_VERSION = 1 as const;

export const SESSION_STATE_STORE_LIMITS = {
  MAX_FILE_BYTES: 32 * 1024,
  RUNTIME_DIRECTORY_MODE: 0o700,
  STATE_FILE_MODE: 0o600,
  FORBIDDEN_MODE_MASK: 0o077,
  MAX_INTEGER: Number.MAX_SAFE_INTEGER,
} as const;

const STATE_FILE_SEGMENTS = ["runtime", "state.json"] as const;
const RUNTIME_DIRECTORY_SEGMENT = "runtime";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TMUX_PANE_PATTERN = /^%\d{1,20}$/;
const TMUX_SESSION_PATTERN = /^\$\d{1,20}$/;
const TMUX_WINDOW_PATTERN = /^@\d{1,20}$/;
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const PERSISTENCE_WRITE_FAILURE = "Session persistence write failed.";

const ENVELOPE_FIELDS = ["schemaVersion", "slots", "retiredSessions"] as const;
const SLOT_ALLOWED_FIELDS = [
  "index",
  "assignmentId",
  "sessionId",
  "source",
  "lifecycle",
  "target",
  "runningSince",
  "acknowledged",
  "lastEventId",
  "lastTimestamp",
  "lastSequence",
] as const;
const TARGET_ALLOWED_FIELDS = ["tmuxPaneId", "tmuxSession", "tmuxWindow", "ghosttyBundleId"] as const;
const RETIRED_ALLOWED_FIELDS = ["sessionId", "lastEventId", "lastTimestamp", "lastSequence"] as const;

export interface SessionStateStoreFilesystem {
  readFile(path: string): Promise<string>;
  stat(path: string): Promise<{ readonly mode: number; readonly uid: number }>;
  mkdir(path: string, options: { readonly mode: number }): Promise<void>;
  writeFile(path: string, contents: string, options: { readonly mode: number }): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
  unlink?(path: string): Promise<void>;
}

export interface SessionStateStoreOptions {
  readonly pluginRoot: string;
  readonly fs: SessionStateStoreFilesystem;
  readonly ownUid: number;
}

export interface SessionStateStore {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const own = Reflect.ownKeys(record);
  for (const field of own) {
    if (typeof field !== "string" || !allowed.includes(field)) return false;
  }
  return true;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID_V4_PATTERN.test(value);
}

function isBoundedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= SESSION_STATE_STORE_LIMITS.MAX_INTEGER;
}

function isTool(value: unknown): value is LocalAgentTool {
  return typeof value === "string" && Object.values(LOCAL_AGENT_TOOL).includes(value as LocalAgentTool);
}

function isStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && Object.values(SESSION_STATUS).includes(value as SessionStatus);
}

function parseTarget(value: unknown): LocalAgentTargetMetadata | undefined {
  if (!isRecord(value) || !hasOnlyFields(value, TARGET_ALLOWED_FIELDS)) return undefined;
  const { tmuxPaneId, tmuxSession, tmuxWindow, ghosttyBundleId } = value;
  if (
    typeof tmuxPaneId !== "string" || !TMUX_PANE_PATTERN.test(tmuxPaneId) ||
    typeof tmuxSession !== "string" || !TMUX_SESSION_PATTERN.test(tmuxSession) ||
    ghosttyBundleId !== GHOSTTY_BUNDLE_ID
  ) return undefined;
  if ("tmuxWindow" in value) {
    if (typeof tmuxWindow !== "string" || !TMUX_WINDOW_PATTERN.test(tmuxWindow)) return undefined;
    return Object.freeze({ tmuxPaneId, tmuxSession, tmuxWindow, ghosttyBundleId });
  }
  return Object.freeze({ tmuxPaneId, tmuxSession, ghosttyBundleId });
}

function parseSlot(value: unknown, seenIndexes: Set<number>): SessionSlot | undefined {
  if (!isRecord(value) || !hasOnlyFields(value, SLOT_ALLOWED_FIELDS)) return undefined;
  const { index } = value;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= SESSION_REDUCER_LIMITS.SLOT_COUNT) return undefined;
  if (seenIndexes.has(index)) return undefined;
  seenIndexes.add(index);

  const slot: Record<string, unknown> = { index };

  if ("assignmentId" in value) { if (!isUuid(value.assignmentId)) return undefined; slot.assignmentId = value.assignmentId; }
  if ("sessionId" in value) { if (!isUuid(value.sessionId)) return undefined; slot.sessionId = value.sessionId; }
  if ("source" in value) { if (!isTool(value.source)) return undefined; slot.source = value.source; }
  if ("lifecycle" in value) { if (!isStatus(value.lifecycle)) return undefined; slot.lifecycle = value.lifecycle; }
  if ("target" in value) { const target = parseTarget(value.target); if (target === undefined) return undefined; slot.target = target; }
  if ("runningSince" in value) { if (!isBoundedInteger(value.runningSince)) return undefined; slot.runningSince = value.runningSince; }
  if ("acknowledged" in value) { if (typeof value.acknowledged !== "boolean") return undefined; slot.acknowledged = value.acknowledged; }
  if ("lastEventId" in value) { if (!isUuid(value.lastEventId)) return undefined; slot.lastEventId = value.lastEventId; }
  if ("lastTimestamp" in value) { if (!isBoundedInteger(value.lastTimestamp)) return undefined; slot.lastTimestamp = value.lastTimestamp; }
  if ("lastSequence" in value) { if (!isBoundedInteger(value.lastSequence)) return undefined; slot.lastSequence = value.lastSequence; }

  return Object.freeze(slot) as unknown as SessionSlot;
}

function parseRetiredSession(value: unknown): RetiredSession | undefined {
  if (!isRecord(value) || !hasOnlyFields(value, RETIRED_ALLOWED_FIELDS)) return undefined;
  const { sessionId, lastEventId, lastTimestamp, lastSequence } = value;
  if (!isUuid(sessionId) || !isUuid(lastEventId) || !isBoundedInteger(lastTimestamp)) return undefined;
  const retired: Record<string, unknown> = { sessionId, lastEventId, lastTimestamp };
  if ("lastSequence" in value) { if (!isBoundedInteger(lastSequence)) return undefined; retired.lastSequence = lastSequence; }
  return Object.freeze(retired) as unknown as RetiredSession;
}

export function serializeSessionState(state: SessionState): string {
  const slots = state.slots.map((slot) => {
    const record: Record<string, unknown> = { index: slot.index };
    if (slot.assignmentId !== undefined) record.assignmentId = slot.assignmentId;
    if (slot.sessionId !== undefined) record.sessionId = slot.sessionId;
    if (slot.source !== undefined) record.source = slot.source;
    if (slot.lifecycle !== undefined) record.lifecycle = slot.lifecycle;
    if (slot.target !== undefined) {
      const target: Record<string, unknown> = {
        tmuxPaneId: slot.target.tmuxPaneId,
        tmuxSession: slot.target.tmuxSession,
        ghosttyBundleId: slot.target.ghosttyBundleId,
      };
      if (slot.target.tmuxWindow !== undefined) target.tmuxWindow = slot.target.tmuxWindow;
      record.target = target;
    }
    if (slot.runningSince !== undefined) record.runningSince = slot.runningSince;
    if (slot.acknowledged !== undefined) record.acknowledged = slot.acknowledged;
    if (slot.lastEventId !== undefined) record.lastEventId = slot.lastEventId;
    if (slot.lastTimestamp !== undefined) record.lastTimestamp = slot.lastTimestamp;
    if (slot.lastSequence !== undefined) record.lastSequence = slot.lastSequence;
    return record;
  });
  const retiredSessions = state.retiredSessions.map((session) => {
    const record: Record<string, unknown> = {
      sessionId: session.sessionId,
      lastEventId: session.lastEventId,
      lastTimestamp: session.lastTimestamp,
    };
    if (session.lastSequence !== undefined) record.lastSequence = session.lastSequence;
    return record;
  });
  return JSON.stringify({
    schemaVersion: SESSION_STATE_STORE_SCHEMA_VERSION,
    slots,
    retiredSessions,
  });
}

export function parseSessionState(contents: string): SessionState | undefined {
  if (contents.length === 0 || contents.length > SESSION_STATE_STORE_LIMITS.MAX_FILE_BYTES) return undefined;
  let value: unknown;
  try { value = JSON.parse(contents); } catch { return undefined; }
  if (!isRecord(value) || !hasOnlyFields(value, ENVELOPE_FIELDS)) return undefined;
  const { schemaVersion, slots, retiredSessions } = value;
  if (schemaVersion !== SESSION_STATE_STORE_SCHEMA_VERSION) return undefined;
  if (!Array.isArray(slots) || slots.length !== SESSION_REDUCER_LIMITS.SLOT_COUNT) return undefined;
  if (!Array.isArray(retiredSessions) || retiredSessions.length > SESSION_REDUCER_LIMITS.RETIRED_SESSION_LIMIT) return undefined;

  const seen = new Set<number>();
  const parsedSlots: SessionSlot[] = [];
  for (const entry of slots) {
    const slot = parseSlot(entry, seen);
    if (slot === undefined) return undefined;
    parsedSlots.push(slot);
  }
  parsedSlots.sort((left, right) => left.index - right.index);

  const parsedRetired: RetiredSession[] = [];
  for (const entry of retiredSessions) {
    const retired = parseRetiredSession(entry);
    if (retired === undefined) return undefined;
    parsedRetired.push(retired);
  }

  return Object.freeze({
    slots: Object.freeze(parsedSlots) as readonly SessionSlot[],
    retiredSessions: Object.freeze(parsedRetired) as readonly RetiredSession[],
  });
}

function isSecureStat(attributes: { readonly mode: number; readonly uid: number }, ownUid: number): boolean {
  return attributes.uid === ownUid && (attributes.mode & SESSION_STATE_STORE_LIMITS.FORBIDDEN_MODE_MASK) === 0;
}

function tempFilename(): string {
  return `state.json.${process.pid}.${randomBytes(8).toString("hex")}`;
}

const NODE_FILESYSTEM: SessionStateStoreFilesystem = {
  readFile: (path) => readFile(path, { encoding: "utf8" }),
  stat: async (path) => {
    const stats = await stat(path);
    return { mode: stats.mode, uid: stats.uid };
  },
  mkdir: async (path, options) => { await mkdir(path, { mode: options.mode, recursive: true }); },
  writeFile: async (path, contents, options) => { await writeFile(path, contents, { mode: options.mode, encoding: "utf8" }); },
  rename: async (from, to) => { await rename(from, to); },
  unlink: async (path) => { try { await unlink(path); } catch { /* fail-open */ } },
};

export function createSessionStateStore(options: SessionStateStoreOptions): SessionStateStore {
  const runtimeDir = join(options.pluginRoot, RUNTIME_DIRECTORY_SEGMENT);
  const statePath = join(options.pluginRoot, ...STATE_FILE_SEGMENTS);

  return {
    async load() {
      let contents: string;
      try {
        contents = await options.fs.readFile(statePath);
      } catch {
        return createSessionState();
      }
      let attributes: { readonly mode: number; readonly uid: number };
      try {
        attributes = await options.fs.stat(statePath);
      } catch {
        return createSessionState();
      }
      if (!isSecureStat(attributes, options.ownUid)) return createSessionState();
      const parsed = parseSessionState(contents);
      return parsed ?? createSessionState();
    },

    async save(state) {
      await options.fs.mkdir(runtimeDir, { mode: SESSION_STATE_STORE_LIMITS.RUNTIME_DIRECTORY_MODE });
      const contents = serializeSessionState(state);
      const tempPath = join(runtimeDir, tempFilename());
      await options.fs.writeFile(tempPath, contents, { mode: SESSION_STATE_STORE_LIMITS.STATE_FILE_MODE });
      try {
        if (options.fs.rename === undefined) throw new Error(PERSISTENCE_WRITE_FAILURE);
        await options.fs.rename(tempPath, statePath);
      } catch {
        if (options.fs.unlink !== undefined) { try { await options.fs.unlink(tempPath); } catch { /* fail-open */ } }
        throw new Error(PERSISTENCE_WRITE_FAILURE);
      }
    },
  };
}

export const productionSessionStateStoreDependencies = {
  fs: NODE_FILESYSTEM,
} as const;
