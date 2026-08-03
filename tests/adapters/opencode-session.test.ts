import { describe, expect, it } from "vitest";

import { OpenCodeSessionTracker } from "../../src/adapters/opencode-session";

describe("OpenCodeSessionTracker", () => {
  it("emits started for the first busy activity of a session and running afterwards", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("started");
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("running");
  });

  it("treats retry as running work, starting the session when unseen", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "retry" } } })).toBe("started");
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "retry" } } })).toBe("running");
  });

  it("emits completed on session.idle even when the busy transition was not observed", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.idle", properties: { sessionID: "ses_1" } })).toBe("completed");
  });

  it("emits error on session.error and lets a later busy turn the slot amber again", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.error", properties: { sessionID: "ses_1" } })).toBe("error");
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("started");
  });

  it("starts a fresh work period with started after an idle completion", () => {
    const tracker = new OpenCodeSessionTracker();
    tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } });
    tracker.lifecycleFor({ type: "session.idle", properties: { sessionID: "ses_1" } });
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("started");
  });

  it("ignores unrelated event types and events without a session id", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.updated", properties: { sessionID: "ses_1" } })).toBeUndefined();
    expect(tracker.lifecycleFor({ type: "message.part.updated", properties: {} })).toBeUndefined();
    expect(tracker.lifecycleFor({ type: "session.status", properties: { status: { type: "busy" } } })).toBeUndefined();
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "idle" } } })).toBeUndefined();
  });

  it("tracks sessions independently", () => {
    const tracker = new OpenCodeSessionTracker();
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("started");
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_2", status: { type: "busy" } } })).toBe("started");
    expect(tracker.lifecycleFor({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })).toBe("running");
  });
});
