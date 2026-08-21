import { describe, expect, it } from "vitest";

import { deriveAdapterSessionId, deriveOpenCodePaneSessionId } from "../../src/adapters/adapter-environment";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deriveAdapterSessionId", () => {
  it("encodes any native session id as a deterministic RFC 4122 version-4 UUID", () => {
    const first = deriveAdapterSessionId("ses_abc123");
    expect(first).toMatch(UUID_V4_PATTERN);
    expect(deriveAdapterSessionId("ses_abc123")).toBe(first);
  });

  it("gives distinct native ids distinct UUIDs", () => {
    expect(deriveAdapterSessionId("ses_a")).not.toBe(deriveAdapterSessionId("ses_b"));
  });

  it("passes through an id that is already a version-4 UUID as a stable derived id", () => {
    const derived = deriveAdapterSessionId("6d1f0f3e-6f3a-4b2e-8f7c-1a2b3c4d5e6f");
    expect(derived).toMatch(UUID_V4_PATTERN);
    expect(deriveAdapterSessionId("6d1f0f3e-6f3a-4b2e-8f7c-1a2b3c4d5e6f")).toBe(derived);
  });
});

describe("deriveOpenCodePaneSessionId", () => {
  it("encodes a tmux session/pane pair as a deterministic RFC 4122 version-4 UUID", () => {
    const first = deriveOpenCodePaneSessionId("$0", "%6");
    expect(first).toMatch(UUID_V4_PATTERN);
    expect(deriveOpenCodePaneSessionId("$0", "%6")).toBe(first);
  });

  it("gives distinct panes and distinct tmux sessions distinct identities", () => {
    const base = deriveOpenCodePaneSessionId("$0", "%6");
    expect(deriveOpenCodePaneSessionId("$0", "%11")).not.toBe(base);
    expect(deriveOpenCodePaneSessionId("$1", "%6")).not.toBe(base);
  });

  it("derives identity from tmux identifiers only, never from a native session id", () => {
    const paneIdentity = deriveOpenCodePaneSessionId("$0", "%6");
    expect(paneIdentity).not.toBe(deriveAdapterSessionId("ses_root"));
    expect(paneIdentity).not.toBe(deriveAdapterSessionId("ses_child"));
  });
});
