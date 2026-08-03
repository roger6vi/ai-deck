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

  it("ignores a finished subagent, which is not a finished turn", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "SubagentStop", sessionId: "ses_1" })).toBeUndefined();
  });

  it("ignores every other hook event", () => {
    expect(lifecycleForClaudeHook({ hookEventName: "PreToolUse", sessionId: "ses_1" })).toBeUndefined();
    expect(lifecycleForClaudeHook({ hookEventName: "Notification", sessionId: "ses_1" })).toBeUndefined();
    expect(lifecycleForClaudeHook({ hookEventName: "SessionStart", sessionId: "ses_1" })).toBeUndefined();
  });
});
