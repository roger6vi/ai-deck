import { describe, expect, it } from "vitest";

import { lifecycleForClaudeHook, parseClaudeHookPayload } from "../../src/adapters/claude-session";

describe("parseClaudeHookPayload", () => {
  it("keeps only the hook event name and the session id", () => {
    const payload = parseClaudeHookPayload(JSON.stringify({
      cwd: "/Users/someone/project",
      hook_event_name: "Stop",
      session_id: "ses_1",
      transcript_path: "/Users/someone/.claude/projects/x/transcript.jsonl",
    }));

    expect(payload).toEqual({ hookEventName: "Stop", sessionId: "ses_1" });
  });

  it("keeps the notification message, which is the only way to tell a permission prompt from idling", () => {
    expect(parseClaudeHookPayload(JSON.stringify({ hook_event_name: "Notification", session_id: "ses_1", message: "Claude needs your permission to use Bash" })))
      .toEqual({ hookEventName: "Notification", sessionId: "ses_1", message: "Claude needs your permission to use Bash" });
  });

  it("rejects payloads that are not JSON objects", () => {
    expect(parseClaudeHookPayload("not json")).toBeUndefined();
    expect(parseClaudeHookPayload("[]")).toBeUndefined();
    expect(parseClaudeHookPayload("null")).toBeUndefined();
    expect(parseClaudeHookPayload("")).toBeUndefined();
  });

  it("rejects payloads whose event name or session id is missing or not a string", () => {
    expect(parseClaudeHookPayload(JSON.stringify({ session_id: "ses_1" }))).toBeUndefined();
    expect(parseClaudeHookPayload(JSON.stringify({ hook_event_name: "Stop" }))).toBeUndefined();
    expect(parseClaudeHookPayload(JSON.stringify({ hook_event_name: 7, session_id: "ses_1" }))).toBeUndefined();
  });
});

describe("lifecycleForClaudeHook", () => {
  it("turns a submitted prompt into started so the key goes amber", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "UserPromptSubmit", sessionId: "ses_1" })).toBe("started");
  });

  it("turns the end of a turn into completed so the key goes blue", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "Stop", sessionId: "ses_1" })).toBe("completed");
  });

  it("releases the slot when the session ends", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "SessionEnd", sessionId: "ses_1" })).toBe("pane-disappeared");
  });

  it("turns a permission prompt blue, because a blocked agent needs you as much as a finished one", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "Notification", sessionId: "ses_1", message: "Claude needs your permission to use Bash" })).toBe("completed");
  });

  it("stays silent on the idle notification, which would re-blue a key already acknowledged", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "Notification", sessionId: "ses_1", message: "Claude is waiting for your input" })).toBeUndefined();
  });

  it("treats an unrecognised notification as worth your attention", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "Notification", sessionId: "ses_1", message: "Something else happened" })).toBe("completed");
    expect(lifecycleForClaudeHook({ hookEventName: "Notification", sessionId: "ses_1" })).toBe("completed");
  });

  it("ignores a finished subagent, which is not a finished turn", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "SubagentStop", sessionId: "ses_1" })).toBeUndefined();
  });

  it("ignores every other hook event", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "PreToolUse", sessionId: "ses_1" })).toBeUndefined();
    expect(lifecycleForClaudeHook({ hookEventName: "SessionStart", sessionId: "ses_1" })).toBeUndefined();
  });
});
