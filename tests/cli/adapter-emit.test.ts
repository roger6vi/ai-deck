import { describe, expect, it, vi } from "vitest";

import { ENDPOINT_CLIENT_OUTCOME, type EndpointClient } from "../../src/adapters/endpoint-client";
import {
  ADAPTER_EMIT_EXIT_CODE,
  ADAPTER_EMIT_OUTCOME_MESSAGE,
  ADAPTER_EMIT_PLUGIN_ROOT_MISSING_MESSAGE,
  isDirectCliInvocation,
  mainAdapterEmit,
  parseAdapterEmitArgs,
  runAdapterEmit,
} from "../../src/cli/adapter-emit";
import type { LocalAgentStatusEvent } from "../../src/core/types";

const NOW = 1_700_000_000_000;
const CLOCK = { now: () => NOW };

const VALID_ARGS: readonly string[] = [
  "--source", "codex",
  "--session-id", "00000000-0000-4000-8000-000000000001",
  "--event-id", "00000000-0000-4000-8000-000000000002",
  "--lifecycle", "started",
  "--pane-id", "%3",
  "--session", "$0",
];

interface StubClient {
  readonly client: EndpointClient;
  readonly calls: LocalAgentStatusEvent[];
}

function stubClient(outcome: keyof typeof ENDPOINT_CLIENT_OUTCOME | (typeof ENDPOINT_CLIENT_OUTCOME)[keyof typeof ENDPOINT_CLIENT_OUTCOME]): StubClient {
  const calls: LocalAgentStatusEvent[] = [];
  const target = typeof outcome === "string" && Object.values(ENDPOINT_CLIENT_OUTCOME).includes(outcome as never)
    ? (outcome as (typeof ENDPOINT_CLIENT_OUTCOME)[keyof typeof ENDPOINT_CLIENT_OUTCOME])
    : ENDPOINT_CLIENT_OUTCOME[outcome as keyof typeof ENDPOINT_CLIENT_OUTCOME];
  return {
    calls,
    client: { emit: async (event) => { calls.push(event); return target; } },
  };
}

describe("parseAdapterEmitArgs", () => {
  it("returns a normalized event for the minimum required flags", () => {
    const parsed = parseAdapterEmitArgs([...VALID_ARGS], CLOCK);
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") return;
    expect(parsed.event).toMatchObject({
      schemaVersion: 1,
      source: "codex",
      sessionId: "00000000-0000-4000-8000-000000000001",
      eventId: "00000000-0000-4000-8000-000000000002",
      lifecycle: "started",
      target: { tmuxPaneId: "%3", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
      timestamp: NOW,
    });
    expect(parsed.event.target).not.toHaveProperty("tmuxWindow");
    expect(parsed.event).not.toHaveProperty("sequence");
  });

  it("adds an optional tmux window and sequence when supplied", () => {
    const parsed = parseAdapterEmitArgs([...VALID_ARGS, "--window", "@2", "--sequence", "5"], CLOCK);
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") return;
    expect(parsed.event.target).toHaveProperty("tmuxWindow", "@2");
    expect(parsed.event.sequence).toBe(5);
  });

  it("generates a valid UUID v4 when --event-id is omitted", () => {
    const argsWithoutEventId = [...VALID_ARGS].filter((_, index, all) => all[index - 1] !== "--event-id" && all[index] !== "--event-id");
    const parsed = parseAdapterEmitArgs(argsWithoutEventId, CLOCK);
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") return;
    expect(parsed.event.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("rejects an unknown source", () => {
    const bad = [...VALID_ARGS];
    bad[bad.indexOf("codex")] = "unknown-agent";
    const parsed = parseAdapterEmitArgs(bad, CLOCK);
    expect(parsed.kind).toBe("invalid");
  });

  it("rejects an invalid lifecycle", () => {
    const bad = [...VALID_ARGS];
    bad[bad.indexOf("started")] = "bogus";
    const parsed = parseAdapterEmitArgs(bad, CLOCK);
    expect(parsed.kind).toBe("invalid");
  });

  it("rejects malformed tmux identifiers", () => {
    const bad = [...VALID_ARGS];
    bad[bad.indexOf("%3")] = "3";
    const parsed = parseAdapterEmitArgs(bad, CLOCK);
    expect(parsed.kind).toBe("invalid");
  });

  it("rejects unknown flags and disallows prompts/output/secrets fields", () => {
    for (const prohibited of ["--prompt", "--transcript", "--secret", "--command", "--file-path"]) {
      const parsed = parseAdapterEmitArgs([...VALID_ARGS, prohibited, "leak"], CLOCK);
      expect(parsed.kind).toBe("invalid");
    }
  });

  it("rejects missing required flags", () => {
    const partial = [...VALID_ARGS].slice(0, 4);
    const parsed = parseAdapterEmitArgs(partial, CLOCK);
    expect(parsed.kind).toBe("invalid");
  });
});

describe("runAdapterEmit", () => {
  it("posts the parsed event and returns EMITTED exit code on 204", async () => {
    const { client, calls } = stubClient(ENDPOINT_CLIENT_OUTCOME.EMITTED);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exit = await runAdapterEmit({
      argv: [...VALID_ARGS],
      clock: CLOCK,
      client,
      stdout: { write: (text) => { stdout.push(text); } },
      stderr: { write: (text) => { stderr.push(text); } },
    });

    expect(exit).toBe(ADAPTER_EMIT_EXIT_CODE.EMITTED);
    expect(calls).toHaveLength(1);
    expect(stdout.join("")).toContain(ADAPTER_EMIT_OUTCOME_MESSAGE.EMITTED);
    expect(stderr.join("")).toBe("");
  });

  it("returns REJECTED and prints usage without contacting the server for invalid args", async () => {
    const { client, calls } = stubClient(ENDPOINT_CLIENT_OUTCOME.EMITTED);
    const stderr: string[] = [];
    const exit = await runAdapterEmit({
      argv: ["--source", "codex"],
      clock: CLOCK,
      client,
      stdout: { write: vi.fn() },
      stderr: { write: (text) => { stderr.push(text); } },
    });

    expect(exit).toBe(ADAPTER_EMIT_EXIT_CODE.REJECTED);
    expect(calls).toHaveLength(0);
    expect(stderr.join("")).toContain("usage");
  });

  it("maps endpoint client outcomes to distinct exit codes", async () => {
    const cases = [
      [ENDPOINT_CLIENT_OUTCOME.EMITTED, ADAPTER_EMIT_EXIT_CODE.EMITTED],
      [ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE, ADAPTER_EMIT_EXIT_CODE.UNAVAILABLE],
      [ENDPOINT_CLIENT_OUTCOME.REJECTED, ADAPTER_EMIT_EXIT_CODE.REJECTED],
      [ENDPOINT_CLIENT_OUTCOME.TIMED_OUT, ADAPTER_EMIT_EXIT_CODE.TIMED_OUT],
      [ENDPOINT_CLIENT_OUTCOME.LOCAL_ERROR, ADAPTER_EMIT_EXIT_CODE.LOCAL_ERROR],
    ] as const;
    for (const [outcome, expected] of cases) {
      const { client } = stubClient(outcome);
      const exit = await runAdapterEmit({
        argv: [...VALID_ARGS],
        clock: CLOCK,
        client,
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
      });
      expect(exit).toBe(expected);
    }
  });

  it("never leaks raw errors to stderr on any transport outcome", async () => {
    const { client } = stubClient(ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE);
    const stderr: string[] = [];
    await runAdapterEmit({
      argv: [...VALID_ARGS],
      clock: CLOCK,
      client,
      stdout: { write: () => undefined },
      stderr: { write: (text) => { stderr.push(text); } },
    });
    const output = stderr.join("");
    expect(output).not.toContain("Error");
    expect(output).not.toMatch(/stack/i);
  });
});

describe("isDirectCliInvocation", () => {
  const moduleUrl = "file:///repo/src/cli/adapter-emit.ts";

  it("returns true when argv[1] resolves to the module path", () => {
    expect(isDirectCliInvocation(moduleUrl, "/repo/src/cli/adapter-emit.ts")).toBe(true);
  });

  it("returns true for a relative argv[1] that resolves to the module path", () => {
    expect(isDirectCliInvocation(moduleUrl, "src/cli/adapter-emit.ts", "/repo")).toBe(true);
  });

  it("returns false for a different entry path", () => {
    expect(isDirectCliInvocation(moduleUrl, "/repo/src/plugin.ts")).toBe(false);
  });

  it("returns false when argv[1] is undefined", () => {
    expect(isDirectCliInvocation(moduleUrl, undefined)).toBe(false);
  });
});

describe("mainAdapterEmit", () => {
  it("returns UNAVAILABLE and never builds a client when the plugin root is missing", async () => {
    const createClient = vi.fn();
    const stderr: string[] = [];
    const exit = await mainAdapterEmit({
      argv: [...VALID_ARGS],
      pluginRoot: undefined,
      clock: CLOCK,
      createClient,
      stdout: { write: () => undefined },
      stderr: { write: (text) => { stderr.push(text); } },
    });

    expect(exit).toBe(ADAPTER_EMIT_EXIT_CODE.UNAVAILABLE);
    expect(createClient).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain(ADAPTER_EMIT_PLUGIN_ROOT_MISSING_MESSAGE);
  });

  it("builds the production client for the plugin root and emits the parsed event", async () => {
    const { client, calls } = stubClient(ENDPOINT_CLIENT_OUTCOME.EMITTED);
    const createClient = vi.fn(() => client);
    const stdout: string[] = [];
    const exit = await mainAdapterEmit({
      argv: [...VALID_ARGS],
      pluginRoot: "/plugin/root",
      clock: CLOCK,
      createClient,
      stdout: { write: (text) => { stdout.push(text); } },
      stderr: { write: () => undefined },
    });

    expect(exit).toBe(ADAPTER_EMIT_EXIT_CODE.EMITTED);
    expect(createClient).toHaveBeenCalledWith("/plugin/root");
    expect(calls).toHaveLength(1);
    expect(stdout.join("")).toContain(ADAPTER_EMIT_OUTCOME_MESSAGE.EMITTED);
  });
});
