import { afterEach, describe, expect, it, vi } from "vitest";

import { PROHIBITED_CONTENT_FIELD, isLocalAgentStatusEvent, parseLocalAgentStatusEvent } from "../../src/core/events";
import {
  LOCAL_AGENT_EVENT_LIMITS,
  LOCAL_AGENT_TOOL,
  SESSION_STATUS,
  type LocalAgentTool,
  type SessionStatus,
} from "../../src/core/types";

const EVENT_ID = "de305d54-75b4-431b-adb2-eb6b9e546014";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SENSITIVE_VALUE = "prompt: confidential work and token=do-not-log";
const INVALID_MESSAGE = "Invalid local agent status event.";
const REQUIRED_PROHIBITED_FIELDS = [
  "prompt", "transcript", "messages", "assistantOutput", "userOutput", "toolOutput", "output",
  "command", "commandLine", "filePath", "fileContents", "secret", "token", "credentials", "raw", "payload",
] as const;
const REQUIRED_EVENT_FIELDS = ["schemaVersion", "eventId", "source", "sessionId", "timestamp", "lifecycle", "target"] as const;
const REQUIRED_TARGET_FIELDS = ["tmuxPaneId", "tmuxSession", "ghosttyBundleId"] as const;
const INVALID_EVENT_VALUES = [
  ["schemaVersion", 2],
  ["source", "unknown"],
  ["lifecycle", "idle"],
  ["target", null],
  ["target", "not-a-target"],
  ["target", []],
] as const;
const UNKNOWN_ALIASES = ["promptText", "transcripts", "commandOutput", "file", "authorization", "rawPayload"] as const;
const TMUX_IDENTIFIERS = [
  { field: "tmuxPaneId", prefix: "%" },
  { field: "tmuxSession", prefix: "$" },
  { field: "tmuxWindow", prefix: "@" },
] as const;
const UNTRUSTED_IDENTIFIERS = [
  "", "\u0000", "é", "sk-proj-secret", "ghp_secret", "AKIASECRET", "eyJvdXRwdXQiOiJzZWNyZXQifQ",
  "echo secret", "/tmp/output", EVENT_ID + "0", "1".repeat(LOCAL_AGENT_EVENT_LIMITS.MAX_TMUX_IDENTIFIER_DIGITS + 1),
] as const;

interface RawEvent {
  [key: string]: unknown;
  target: Record<string, unknown>;
}

function event(
  source: LocalAgentTool = LOCAL_AGENT_TOOL.CODEX,
  lifecycle: SessionStatus = SESSION_STATUS.RUNNING,
  sequence = false,
  window = false,
): RawEvent {
  const target: Record<string, unknown> = {
    tmuxPaneId: "%2", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty",
  };
  if (window) target.tmuxWindow = "@1";
  const value: RawEvent = {
    schemaVersion: LOCAL_AGENT_EVENT_LIMITS.SCHEMA_VERSION,
    eventId: EVENT_ID, source, sessionId: SESSION_ID, timestamp: 0, lifecycle, target,
  };
  if (sequence) value.sequence = 0;
  return value;
}

function withField(field: string, value: unknown, nested = false): RawEvent {
  const raw = event();
  return nested ? { ...raw, target: { ...raw.target, [field]: value } } : { ...raw, [field]: value };
}

function expectInvalid(value: unknown, sensitive = false): void {
  try {
    parseLocalAgentStatusEvent(value);
  } catch (error: unknown) {
    expect((error as Error).message).toBe(INVALID_MESSAGE);
    if (sensitive) expect((error as Error).message).not.toContain(SENSITIVE_VALUE);
    return;
  }
  throw new Error("Expected parser to reject invalid event.");
}

afterEach(() => vi.restoreAllMocks());

describe("local agent status event privacy boundary", () => {
  const validCases = Object.values(LOCAL_AGENT_TOOL).flatMap((source) =>
    Object.values(SESSION_STATUS).flatMap((lifecycle) =>
      [false, true].flatMap((sequence) => [false, true].map((window) => ({ source, lifecycle, sequence, window }))),
    ),
  );

  it.each(validCases)("normalizes %o", ({ source, lifecycle, sequence, window }) => {
    const raw = event(source, lifecycle, sequence, window);
    expect(isLocalAgentStatusEvent(raw)).toBe(true);
    const parsed = parseLocalAgentStatusEvent(raw);
    expect(parsed).toMatchObject({ schemaVersion: LOCAL_AGENT_EVENT_LIMITS.SCHEMA_VERSION, source, lifecycle });
    expect(Object.hasOwn(parsed, "sequence")).toBe(sequence);
    expect(Object.hasOwn(parsed.target, "tmuxWindow")).toBe(window);
  });

  it("documents every prohibited contract field", () => {
    expect(Object.values(PROHIBITED_CONTENT_FIELD).sort()).toEqual([...REQUIRED_PROHIBITED_FIELDS].sort());
  });

  it.each(REQUIRED_PROHIBITED_FIELDS)("rejects prohibited %s at both levels", (field) => {
    expectInvalid(withField(field, SENSITIVE_VALUE), true);
    expectInvalid(withField(field, SENSITIVE_VALUE, true), true);
  });

  it.each(UNKNOWN_ALIASES)("rejects unknown alias %s at both levels", (field) => {
    expectInvalid(withField(field, SENSITIVE_VALUE), true);
    expectInvalid(withField(field, SENSITIVE_VALUE, true), true);
  });

  it.each(INVALID_EVENT_VALUES)("rejects invalid %s", (field, value) => {
    expectInvalid(withField(field, value));
  });

  it.each(REQUIRED_EVENT_FIELDS)("rejects omitted required %s", (field) => {
    const raw = event();
    delete raw[field];
    expectInvalid(raw);
  });

  it.each(REQUIRED_TARGET_FIELDS)("rejects omitted required target %s", (field) => {
    const raw = event();
    delete raw.target[field];
    expectInvalid(raw);
  });

  it.each([
    ...["eventId", "sessionId"].flatMap((field) => UNTRUSTED_IDENTIFIERS.map((value) => ({ field, value, nested: false }))),
    ...TMUX_IDENTIFIERS.flatMap(({ field, prefix }) =>
      UNTRUSTED_IDENTIFIERS.map((value) => ({ field, value: `${prefix}${value}`, nested: true })),
    ),
    ...UNTRUSTED_IDENTIFIERS.map((value) => ({ field: "ghosttyBundleId", value, nested: true })),
    { field: "eventId", value: "DE305D54-75B4-431B-ADB2-EB6B9E546014", nested: false },
    { field: "sessionId", value: "de305d54-75b4-11eb-adb2-eb6b9e546014", nested: false },
  ])("rejects unsafe identifier %#", ({ field, value, nested }) => {
    expectInvalid(withField(field, value, nested));
  });

  it.each(TMUX_IDENTIFIERS)("accepts 20 digits and rejects 21 for %s", ({ field, prefix }) => {
    const raw = event();
    raw.target[field] = `${prefix}${"9".repeat(LOCAL_AGENT_EVENT_LIMITS.MAX_TMUX_IDENTIFIER_DIGITS)}`;
    expect(parseLocalAgentStatusEvent(raw).target[field]).toBe(raw.target[field]);
    expectInvalid(withField(field, `${prefix}${"9".repeat(LOCAL_AGENT_EVENT_LIMITS.MAX_TMUX_IDENTIFIER_DIGITS + 1)}`, true));
  });

  it.each(["timestamp", "sequence"] as const)("accepts numeric bounds for %s", (field) => {
    for (const value of [0, LOCAL_AGENT_EVENT_LIMITS.MAX_INTEGER]) {
      const raw = event();
      raw[field] = value;
      expect(parseLocalAgentStatusEvent(raw)[field]).toBe(value);
    }
  });

  it.each(["timestamp", "sequence"] as const)("rejects unsafe numeric %s", (field) => {
    for (const value of [-1, 0.5, Infinity, NaN, LOCAL_AGENT_EVENT_LIMITS.MAX_INTEGER + 1]) {
      expectInvalid(withField(field, value));
    }
  });

  it("returns an isolated deeply frozen null-prototype value", () => {
    const raw = event();
    const parsed = parseLocalAgentStatusEvent(raw);
    raw.sessionId = SESSION_ID.replace("0", "1");
    raw.target.tmuxPaneId = "%99";
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf(parsed.target)).toBeNull();
    expect("toString" in parsed).toBe(false);
    expect("constructor" in parsed.target).toBe(false);
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "eventId", "source", "sessionId", "timestamp", "lifecycle", "target"]);
    expect(parsed).toMatchObject({ sessionId: SESSION_ID, target: { tmuxPaneId: "%2" } });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.target)).toBe(true);
  });

  it("uses generic errors and never logs submitted data", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expectInvalid(withField("prompt", SENSITIVE_VALUE), true);
    expect(isLocalAgentStatusEvent(withField("token", SENSITIVE_VALUE))).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
