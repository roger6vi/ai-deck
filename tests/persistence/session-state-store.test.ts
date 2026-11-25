import { describe, expect, it } from "vitest";

import { createSessionState, SESSION_REDUCER_LIMITS, reduceSessionState, SESSION_REDUCER_ACTION, type SessionState } from "../../src/core/reducer";
import {
  SESSION_STATE_STORE_SCHEMA_VERSION,
  createSessionStateStore,
  parseSessionState,
  serializeSessionState,
  type SessionStateStoreFilesystem,
} from "../../src/persistence/session-state-store";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";

const OWN_UID = 501;
const PLUGIN_ROOT = "/plugin/root";
const STATE_PATH = "/plugin/root/runtime/state.json";

function baseEvent(overrides: Partial<LocalAgentStatusEvent> = {}): LocalAgentStatusEvent {
  return {
    schemaVersion: 1,
    eventId: overrides.eventId ?? "00000000-0000-4000-8000-000000000001",
    source: overrides.source ?? "codex",
    sessionId: overrides.sessionId ?? "00000000-0000-4000-8000-000000000002",
    timestamp: overrides.timestamp ?? 1_000,
    lifecycle: overrides.lifecycle ?? SESSION_STATUS.STARTED,
    target: overrides.target ?? {
      tmuxPaneId: "%1",
      tmuxSession: "$0",
      ghosttyBundleId: "com.mitchellh.ghostty",
    },
    ...(overrides.sequence === undefined ? {} : { sequence: overrides.sequence }),
  };
}

function populated(): SessionState {
  const empty = createSessionState();
  const started = reduceSessionState(empty, {
    kind: SESSION_REDUCER_ACTION.EVENT,
    event: baseEvent({ lifecycle: SESSION_STATUS.STARTED, sequence: 1 }),
  });
  const running = reduceSessionState(started, {
    kind: SESSION_REDUCER_ACTION.EVENT,
    event: baseEvent({
      eventId: "00000000-0000-4000-8000-000000000003",
      lifecycle: SESSION_STATUS.RUNNING,
      timestamp: 2_000,
      sequence: 2,
    }),
  });
  return reduceSessionState(running, {
    kind: SESSION_REDUCER_ACTION.EVENT,
    event: baseEvent({
      eventId: "00000000-0000-4000-8000-000000000004",
      lifecycle: SESSION_STATUS.COMPLETED,
      timestamp: 3_000,
      sequence: 3,
    }),
  });
}

function stubFs(overrides: Partial<SessionStateStoreFilesystem> = {}): SessionStateStoreFilesystem {
  return {
    readFile: async () => serializeSessionState(createSessionState()),
    stat: async () => ({ mode: 0o600, uid: OWN_UID }),
    writeFile: async () => undefined,
    mkdir: async () => undefined,
    ...overrides,
  };
}

describe("session state serialization", () => {
  it("roundtrips a populated state exactly", () => {
    const state = populated();
    const serialized = serializeSessionState(state);
    const parsed = parseSessionState(serialized);
    expect(parsed).toEqual(state);
  });

  it("roundtrips the initial empty state", () => {
    const state = createSessionState();
    expect(parseSessionState(serializeSessionState(state))).toEqual(state);
  });

  it("writes a valid schema envelope with exact allowlisted fields", () => {
    const state = populated();
    const raw = JSON.parse(serializeSessionState(state));
    expect(Object.keys(raw).sort()).toEqual(["retiredSessions", "schemaVersion", "slots", "unassignedSessions"]);
    expect(raw.schemaVersion).toBe(SESSION_STATE_STORE_SCHEMA_VERSION);
    expect(raw.slots).toHaveLength(SESSION_REDUCER_LIMITS.SLOT_COUNT);
  });

  it("survives a restart with a session the user left unassigned", () => {
    const cleared = reduceSessionState(populated(), { kind: SESSION_REDUCER_ACTION.CLEAR_SLOT, slotIndex: 0 });
    expect(cleared.unassignedSessions).toHaveLength(1);

    const restored = parseSessionState(serializeSessionState(cleared));

    expect(restored?.unassignedSessions).toEqual(cleared.unassignedSessions);
    expect(restored?.slots[0]).toEqual({ index: 0 });
  });

  it("reads a state file written before unassigned sessions existed", () => {
    const raw = JSON.parse(serializeSessionState(populated()));
    delete raw.unassignedSessions;

    const restored = parseSessionState(JSON.stringify(raw));

    expect(restored?.unassignedSessions).toEqual([]);
    expect(restored?.slots[0]?.sessionId).toBeDefined();
  });

  it("rejects malformed JSON", () => {
    expect(parseSessionState("{")).toBeUndefined();
    expect(parseSessionState("")).toBeUndefined();
    expect(parseSessionState("null")).toBeUndefined();
  });

  it("rejects unknown top-level fields", () => {
    const raw = JSON.parse(serializeSessionState(populated())) as Record<string, unknown>;
    raw.extra = true;
    expect(parseSessionState(JSON.stringify(raw))).toBeUndefined();
  });

  it("rejects mismatched schema version", () => {
    const raw = JSON.parse(serializeSessionState(populated())) as { schemaVersion: number };
    raw.schemaVersion = 2;
    expect(parseSessionState(JSON.stringify(raw))).toBeUndefined();
  });

  it("rejects wrong slot count", () => {
    const raw = JSON.parse(serializeSessionState(populated())) as { slots: unknown[] };
    raw.slots.pop();
    expect(parseSessionState(JSON.stringify(raw))).toBeUndefined();
  });

  it("rejects out-of-range or duplicate slot indexes", () => {
    const badIndex = JSON.parse(serializeSessionState(populated())) as { slots: { index: number }[] };
    badIndex.slots[0]!.index = SESSION_REDUCER_LIMITS.SLOT_COUNT;
    expect(parseSessionState(JSON.stringify(badIndex))).toBeUndefined();

    const duplicate = JSON.parse(serializeSessionState(populated())) as { slots: { index: number }[] };
    duplicate.slots[1]!.index = duplicate.slots[0]!.index;
    expect(parseSessionState(JSON.stringify(duplicate))).toBeUndefined();
  });

  it("rejects invalid identifiers, targets, and enum values in slots", () => {
    interface RawSlot {
      sessionId?: string;
      lifecycle?: string;
      source?: string;
      target?: { tmuxPaneId?: string; ghosttyBundleId?: string };
    }
    interface RawState { slots: RawSlot[] }
    const mutations: ReadonlyArray<(raw: RawState) => void> = [
      (raw) => { const slot = raw.slots[0]!; slot.sessionId = "not-a-uuid"; },
      (raw) => { const target = raw.slots[0]!.target; if (target) target.tmuxPaneId = "1"; },
      (raw) => { const target = raw.slots[0]!.target; if (target) target.ghosttyBundleId = "com.other.terminal"; },
      (raw) => { const slot = raw.slots[0]!; slot.lifecycle = "bogus"; },
      (raw) => { const slot = raw.slots[0]!; slot.source = "unknown-agent"; },
    ];

    for (const mutate of mutations) {
      const raw = JSON.parse(serializeSessionState(populated())) as RawState;
      mutate(raw);
      expect(parseSessionState(JSON.stringify(raw))).toBeUndefined();
    }
  });

  it("rejects prohibited or unknown slot fields", () => {
    const raw = JSON.parse(serializeSessionState(populated())) as { slots: Record<string, unknown>[] };
    raw.slots[0]!.prompt = "hidden secret";
    expect(parseSessionState(JSON.stringify(raw))).toBeUndefined();
  });

  it("rejects retired sessions with invalid ids or timestamps", () => {
    const badUuid = JSON.parse(serializeSessionState(populated())) as { retiredSessions: unknown[] };
    badUuid.retiredSessions.push({ sessionId: "nope", lastEventId: "00000000-0000-4000-8000-000000000009", lastTimestamp: 1 });
    expect(parseSessionState(JSON.stringify(badUuid))).toBeUndefined();

    const badTimestamp = JSON.parse(serializeSessionState(populated())) as { retiredSessions: unknown[] };
    badTimestamp.retiredSessions.push({ sessionId: "00000000-0000-4000-8000-000000000009", lastEventId: "00000000-0000-4000-8000-00000000000a", lastTimestamp: -1 });
    expect(parseSessionState(JSON.stringify(badTimestamp))).toBeUndefined();
  });
});

describe("session state store", () => {
  it("load returns a fresh empty state when the file is missing", async () => {
    const store = createSessionStateStore({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } }),
      ownUid: OWN_UID,
    });

    const state = await store.load();
    expect(state).toEqual(createSessionState());
  });

  it("load returns a fresh empty state when the file is corrupt", async () => {
    const store = createSessionStateStore({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: async () => "{ not json" }),
      ownUid: OWN_UID,
    });

    expect(await store.load()).toEqual(createSessionState());
  });

  it("load returns a fresh empty state when the file has insecure ownership or mode", async () => {
    const cases = [
      { mode: 0o604, uid: OWN_UID },
      { mode: 0o640, uid: OWN_UID },
      { mode: 0o600, uid: OWN_UID + 1 },
    ] as const;

    for (const attributes of cases) {
      const store = createSessionStateStore({
        pluginRoot: PLUGIN_ROOT,
        fs: stubFs({ readFile: async () => serializeSessionState(populated()), stat: async () => attributes }),
        ownUid: OWN_UID,
      });
      expect(await store.load()).toEqual(createSessionState());
    }
  });

  it("load returns the parsed state when the file is valid and secure", async () => {
    const persisted = populated();
    const store = createSessionStateStore({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: async () => serializeSessionState(persisted) }),
      ownUid: OWN_UID,
    });

    expect(await store.load()).toEqual(persisted);
  });

  it("save writes to a temp file then renames into place with 0o600 and 0o700 runtime dir", async () => {
    const calls: string[] = [];
    let renameFrom = ""; let renameTo = "";
    let mkdirPath = ""; let mkdirMode = 0;
    let writeFilePath = ""; let writeFileMode = 0; let writeFileContents = "";
    const store = createSessionStateStore({
      pluginRoot: PLUGIN_ROOT,
      fs: {
        readFile: async () => "",
        stat: async () => ({ mode: 0o600, uid: OWN_UID }),
        mkdir: async (path, options) => { calls.push("mkdir"); mkdirPath = path; mkdirMode = options.mode; },
        writeFile: async (path, contents, options) => { calls.push("writeFile"); writeFilePath = path; writeFileContents = contents; writeFileMode = options.mode; },
        rename: async (from, to) => { calls.push("rename"); renameFrom = from; renameTo = to; },
      },
      ownUid: OWN_UID,
    });

    await store.save(populated());

    expect(calls).toEqual(["mkdir", "writeFile", "rename"]);
    expect(mkdirPath).toBe("/plugin/root/runtime");
    expect(mkdirMode).toBe(0o700);
    expect(writeFileMode).toBe(0o600);
    expect(writeFilePath.startsWith("/plugin/root/runtime/state.json.")).toBe(true);
    expect(writeFilePath).not.toBe(STATE_PATH);
    expect(renameFrom).toBe(writeFilePath);
    expect(renameTo).toBe(STATE_PATH);
    expect(parseSessionState(writeFileContents)).toEqual(populated());
  });

  it("save removes the temp file when rename fails and rethrows a generic error", async () => {
    let unlinked: string | undefined;
    const store = createSessionStateStore({
      pluginRoot: PLUGIN_ROOT,
      fs: {
        readFile: async () => "",
        stat: async () => ({ mode: 0o600, uid: OWN_UID }),
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        rename: async () => { throw new Error("EIO: raw filesystem error path"); },
        unlink: async (path) => { unlinked = path; },
      },
      ownUid: OWN_UID,
    });

    await expect(store.save(populated())).rejects.toThrow(/persistence/i);
    expect(unlinked).toBeDefined();
    expect(unlinked?.startsWith("/plugin/root/runtime/state.json.")).toBe(true);
  });
});

describe("legacy OpenCode snapshots", () => {
  const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
  const target = (pane: string, session = "$0") => ({ tmuxPaneId: pane, tmuxSession: session, ghosttyBundleId: "com.mitchellh.ghostty" });
  const legacy = (n: number, pane: string, lifecycle: string = "completed") => ({
    assignmentId: uuid(n + 100), sessionId: uuid(n), source: "opencode", lifecycle, target: target(pane),
    runningSince: 5, acknowledged: false, lastEventId: uuid(n + 200), lastTimestamp: 10, lastSequence: 3,
  });
  const codex = (n: number, pane: string) => ({
    assignmentId: uuid(n + 100), sessionId: uuid(n), source: "codex", lifecycle: "running", target: target(pane),
    lastEventId: uuid(n + 200), lastTimestamp: 10,
  });
  function snapshot(slots: readonly (Record<string, unknown> | undefined)[], unassignedSessions: readonly Record<string, unknown>[] = []): string {
    return JSON.stringify({
      schemaVersion: 1,
      slots: Array.from({ length: 5 }, (_, index) => ({ index, ...(slots[index] ?? {}) })),
      unassignedSessions,
      retiredSessions: [],
    });
  }
  function codexEvent(sessionN: number, pane: string, timestamp = 1_000): LocalAgentStatusEvent {
    return baseEvent({ eventId: uuid(sessionN + 300), sessionId: uuid(sessionN), timestamp, target: target(pane) });
  }
  function entriesOn(state: SessionState, pane: string) {
    return [...state.slots, ...state.unassignedSessions].filter((entry) => entry.target?.tmuxPaneId === pane);
  }

  it("hydrates old snapshots instead of discarding the whole state, keeping schema version 1", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6"), codex(2, "%8")], [legacy(3, "%7")]));

    expect(parsed).toBeDefined();
    expect(SESSION_STATE_STORE_SCHEMA_VERSION).toBe(1);
    expect(parsed?.slots[0]).toMatchObject({ sessionId: uuid(1), assignmentId: uuid(101), source: "tmux", lifecycle: SESSION_STATUS.IDLE });
    expect(parsed?.slots[1]).toMatchObject({ sessionId: uuid(2), source: "codex", lifecycle: "running" });
    expect(parsed?.unassignedSessions[0]).toMatchObject({ sessionId: uuid(3), assignmentId: uuid(103), source: "tmux", lifecycle: SESSION_STATUS.IDLE });
  });

  it("keeps the legacy marker persistence-only: it is never held in memory or written back", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6", "running")], [legacy(3, "%7")]))!;
    const written = serializeSessionState(parsed);

    expect(JSON.stringify(parsed)).not.toContain("opencode");
    expect(written).not.toContain("opencode");
    expect(parseSessionState(written)).toEqual(parsed);
    // Stale OpenCode lifecycle bookkeeping must not outlive the adapter.
    expect(parsed.slots[0]).not.toHaveProperty("runningSince");
    expect(parsed.slots[0]).not.toHaveProperty("lastEventId");
  });

  it("upgrades a legacy keyed entry in place when a supported tool reports on that exact pane", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6")]))!;

    const upgraded = reduceSessionState(parsed, { kind: SESSION_REDUCER_ACTION.EVENT, event: codexEvent(9, "%6") });

    expect(upgraded.slots[0]).toMatchObject({ index: 0, assignmentId: uuid(101), sessionId: uuid(9), source: "codex", lifecycle: SESSION_STATUS.STARTED });
    expect(entriesOn(upgraded, "%6")).toHaveLength(1);
    expect(upgraded.unassignedSessions).toHaveLength(0);
  });

  it("upgrades a parked legacy entry without duplicating it or losing its assignment", () => {
    const others = [codex(11, "%11"), codex(12, "%12"), codex(13, "%13"), codex(14, "%14"), codex(15, "%15")];
    const parsed = parseSessionState(snapshot(others, [legacy(3, "%7")]))!;

    const upgraded = reduceSessionState(parsed, { kind: SESSION_REDUCER_ACTION.EVENT, event: codexEvent(9, "%7") });

    expect(upgraded.slots.map((slot) => slot.sessionId)).toEqual(others.map((slot) => slot.sessionId));
    expect(upgraded.unassignedSessions).toHaveLength(1);
    expect(upgraded.unassignedSessions[0]).toMatchObject({ assignmentId: uuid(103), sessionId: uuid(9), source: "codex" });
  });

  it("leaves a legacy entry alone for events on other panes or other tmux sessions", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6")]))!;

    const otherPane = reduceSessionState(parsed, { kind: SESSION_REDUCER_ACTION.EVENT, event: codexEvent(9, "%9") });
    const otherSession = reduceSessionState(parsed, { kind: SESSION_REDUCER_ACTION.EVENT, event: baseEvent({ sessionId: uuid(8), target: target("%6", "$1") }) });

    expect(otherPane.slots[0]).toEqual(parsed.slots[0]);
    expect(otherSession.slots[0]).toEqual(parsed.slots[0]);
  });

  it("does not duplicate the pane when discovery later reports it", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6")], [legacy(3, "%7")]))!;

    const discovered = reduceSessionState(parsed, {
      kind: SESSION_REDUCER_ACTION.PANE_DISCOVERY,
      panes: [{ sessionId: uuid(50), target: target("%6") }, { sessionId: uuid(51), target: target("%7") }],
    });

    expect(entriesOn(discovered, "%6")).toHaveLength(1);
    expect(entriesOn(discovered, "%7")).toHaveLength(1);
  });

  it("collapses several legacy generations of one pane into one entry, preferring the keyed one", () => {
    const parsed = parseSessionState(snapshot([legacy(1, "%6"), legacy(2, "%6")], [legacy(3, "%6"), legacy(4, "%7")]))!;

    expect(entriesOn(parsed, "%6").map((entry) => entry.sessionId)).toEqual([uuid(1)]);
    expect(entriesOn(parsed, "%7")).toHaveLength(1);
  });

  it("drops a legacy entry when a supported tool already owns the same pane", () => {
    const parsed = parseSessionState(snapshot([codex(2, "%6"), legacy(1, "%6")]))!;

    expect(entriesOn(parsed, "%6").map((entry) => entry.sessionId)).toEqual([uuid(2)]);
    expect(parsed.slots[1]).toEqual({ index: 1 });
  });

  it("preserves a legacy key when supported session state for its pane was unassigned", () => {
    const active = codex(2, "%6");
    const parsed = parseSessionState(snapshot([legacy(1, "%6")], [active, codex(3, "%8")]));

    expect(parsed?.slots[0]).toEqual({ ...active, index: 0, assignmentId: uuid(101) });
    expect(parsed?.unassignedSessions).toEqual([codex(3, "%8")]);
  });

  it("discards a legacy entry that names no pane, since nothing could upgrade it", () => {
    const { target: _target, ...unaddressable } = legacy(1, "%6");
    const parsed = parseSessionState(snapshot([unaddressable]))!;

    expect(parsed.slots[0]).toEqual({ index: 0 });
  });

  it("still rejects unknown sources and malformed legacy entries", () => {
    expect(parseSessionState(snapshot([{ ...legacy(1, "%6"), source: "opencode2" }]))).toBeUndefined();
    expect(parseSessionState(snapshot([{ ...legacy(1, "%6"), sessionId: "nope" }]))).toBeUndefined();
    expect(parseSessionState(snapshot([{ ...legacy(1, "%6"), prompt: "x" }]))).toBeUndefined();
  });
});
