import { describe, expect, it } from "vitest";

import { codexLifecycleFor, CODEX_HOOK_LIFECYCLES, parseCodexHookPayload } from "../../src/adapters/codex-session";

describe("parseCodexHookPayload", () => {
  it("keeps only the session id", () => {
    expect(parseCodexHookPayload(JSON.stringify({
      cwd: "/Users/someone/project",
      prompt: "do the thing",
      session_id: "thread_1",
    }))).toEqual({ sessionId: "thread_1" });
  });

  it("rejects anything that is not a JSON object with a session id", () => {
    expect(parseCodexHookPayload("not json")).toBeUndefined();
    expect(parseCodexHookPayload("[]")).toBeUndefined();
    expect(parseCodexHookPayload("")).toBeUndefined();
    expect(parseCodexHookPayload(JSON.stringify({ cwd: "/x" }))).toBeUndefined();
    expect(parseCodexHookPayload(JSON.stringify({ session_id: 7 }))).toBeUndefined();
    expect(parseCodexHookPayload(JSON.stringify({ session_id: "" }))).toBeUndefined();
  });
});

describe("codexLifecycleFor", () => {
  it("accepts the lifecycles the bundled hooks declare", () => {
    expect(codexLifecycleFor("started")).toBe("started");
    expect(codexLifecycleFor("completed")).toBe("completed");
    expect(codexLifecycleFor("pane-disappeared")).toBe("pane-disappeared");
  });

  it("refuses a lifecycle the hooks are not allowed to send", () => {
    expect(codexLifecycleFor("running")).toBeUndefined();
    expect(codexLifecycleFor("error")).toBeUndefined();
    expect(codexLifecycleFor("whatever")).toBeUndefined();
    expect(codexLifecycleFor(undefined)).toBeUndefined();
  });

  it("publishes the allowlist the hooks file is checked against", () => {
    expect([...CODEX_HOOK_LIFECYCLES].sort()).toEqual(["completed", "pane-disappeared", "started"]);
  });
});
