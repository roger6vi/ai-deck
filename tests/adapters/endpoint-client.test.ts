import { describe, expect, it } from "vitest";

import {
  ENDPOINT_CLIENT_LIMITS,
  ENDPOINT_CLIENT_OUTCOME,
  createEndpointClient,
  type EndpointClientFilesystem,
  type EndpointClientHttp,
  type EndpointClientHttpRequest,
  type EndpointClientTimer,
} from "../../src/adapters/endpoint-client";
import type { LocalAgentStatusEvent } from "../../src/core/types";

const OWN_UID = 501;
const PLUGIN_ROOT = "/plugin/root";
const TOKEN = "0123456789ABCDEFabcdef0123456789__--";
const VALID_EVENT: LocalAgentStatusEvent = Object.freeze({
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000001",
  source: "codex",
  sessionId: "00000000-0000-4000-8000-000000000002",
  timestamp: 0,
  lifecycle: "started",
  target: Object.freeze({
    tmuxPaneId: "%1",
    tmuxSession: "$0",
    ghosttyBundleId: "com.mitchellh.ghostty",
  }),
});

interface Recorded {
  readonly request: EndpointClientHttpRequest;
  readonly body: string;
}

function endpointJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    address: "127.0.0.1",
    port: 55_555,
    token: TOKEN,
    pid: 1234,
    ...overrides,
  });
}

function stubFs(overrides: Partial<EndpointClientFilesystem> = {}): EndpointClientFilesystem {
  return {
    readFile: async () => endpointJson(),
    stat: async () => ({ mode: 0o600, uid: OWN_UID }),
    ...overrides,
  };
}

function stubHttp(responder: (request: EndpointClientHttpRequest, body: string) => Promise<{ status: number }> | { status: number }): { http: EndpointClientHttp; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const http: EndpointClientHttp = {
    request: async (request, body) => {
      recorded.push({ request, body });
      return responder(request, body);
    },
  };
  return { http, recorded };
}

function immediateTimer(): EndpointClientTimer {
  return {
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
}

describe("endpoint client", () => {
  it("posts a normalized event with bearer token and returns emitted on 204", async () => {
    const { http, recorded } = stubHttp(() => ({ status: 204 }));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs(),
      http,
      timer: immediateTimer(),
      ownUid: OWN_UID,
    });

    const outcome = await client.emit(VALID_EVENT);

    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.EMITTED);
    expect(recorded).toHaveLength(1);
    const [call] = recorded;
    expect(call?.request.host).toBe("127.0.0.1");
    expect(call?.request.port).toBe(55_555);
    expect(call?.request.method).toBe("POST");
    expect(call?.request.path).toBe("/v1/events");
    expect(call?.request.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call?.request.headers["content-type"]).toBe("application/json");
    expect(call?.request.timeoutMs).toBeLessThanOrEqual(ENDPOINT_CLIENT_LIMITS.TOTAL_BUDGET_MS);
    expect(JSON.parse(call?.body ?? "")).toEqual(VALID_EVENT);
  });

  it("returns rejected without contacting the server when the event fails allowlist validation", async () => {
    const { http, recorded } = stubHttp(() => ({ status: 204 }));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs(),
      http,
      timer: immediateTimer(),
      ownUid: OWN_UID,
    });

    const outcome = await client.emit({ ...VALID_EVENT, lifecycle: "bogus" as never });

    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.REJECTED);
    expect(recorded).toHaveLength(0);
  });

  it("returns unavailable when the endpoint file is missing", async () => {
    const { http } = stubHttp(() => ({ status: 204 }));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } }),
      http,
      timer: immediateTimer(),
      ownUid: OWN_UID,
    });

    const outcome = await client.emit(VALID_EVENT);

    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE);
  });

  it("returns unavailable when the endpoint file is not exclusively owned by this uid or is group/world readable", async () => {
    const cases = [
      { mode: 0o604, uid: OWN_UID },
      { mode: 0o640, uid: OWN_UID },
      { mode: 0o600, uid: OWN_UID + 1 },
    ] as const;

    for (const attributes of cases) {
      const { http, recorded } = stubHttp(() => ({ status: 204 }));
      const client = createEndpointClient({
        pluginRoot: PLUGIN_ROOT,
        fs: stubFs({ stat: async () => attributes }),
        http,
        timer: immediateTimer(),
        ownUid: OWN_UID,
      });

      const outcome = await client.emit(VALID_EVENT);

      expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE);
      expect(recorded).toHaveLength(0);
    }
  });

  it("returns unavailable when the endpoint record is malformed or has unknown fields", async () => {
    const cases = [
      "{",
      JSON.stringify({ schemaVersion: 2, address: "127.0.0.1", port: 1, token: TOKEN, pid: 1 }),
      JSON.stringify({ schemaVersion: 1, address: "10.0.0.1", port: 1, token: TOKEN, pid: 1 }),
      JSON.stringify({ schemaVersion: 1, address: "127.0.0.1", port: 0, token: TOKEN, pid: 1 }),
      JSON.stringify({ schemaVersion: 1, address: "127.0.0.1", port: 65_536, token: TOKEN, pid: 1 }),
      JSON.stringify({ schemaVersion: 1, address: "127.0.0.1", port: 1, token: "short", pid: 1 }),
      JSON.stringify({ schemaVersion: 1, address: "127.0.0.1", port: 1, token: TOKEN, pid: 1, extra: true }),
    ];

    for (const contents of cases) {
      const { http, recorded } = stubHttp(() => ({ status: 204 }));
      const client = createEndpointClient({
        pluginRoot: PLUGIN_ROOT,
        fs: stubFs({ readFile: async () => contents }),
        http,
        timer: immediateTimer(),
        ownUid: OWN_UID,
      });

      const outcome = await client.emit(VALID_EVENT);

      expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE);
      expect(recorded).toHaveLength(0);
    }
  });

  it("maps http statuses to outcomes without leaking response bodies", async () => {
    const cases = [
      { status: 204, outcome: ENDPOINT_CLIENT_OUTCOME.EMITTED },
      { status: 401, outcome: ENDPOINT_CLIENT_OUTCOME.REJECTED },
      { status: 400, outcome: ENDPOINT_CLIENT_OUTCOME.REJECTED },
      { status: 404, outcome: ENDPOINT_CLIENT_OUTCOME.REJECTED },
      { status: 415, outcome: ENDPOINT_CLIENT_OUTCOME.REJECTED },
      { status: 413, outcome: ENDPOINT_CLIENT_OUTCOME.REJECTED },
      { status: 503, outcome: ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE },
      { status: 500, outcome: ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE },
    ] as const;

    for (const { status, outcome: expected } of cases) {
      const { http } = stubHttp(() => ({ status }));
      const client = createEndpointClient({
        pluginRoot: PLUGIN_ROOT,
        fs: stubFs(),
        http,
        timer: immediateTimer(),
        ownUid: OWN_UID,
      });

      const outcome = await client.emit(VALID_EVENT);
      expect(outcome).toBe(expected);
    }
  });

  it("returns unavailable when the transport rejects (network refused, socket error)", async () => {
    const { http } = stubHttp(() => { throw new Error("ECONNREFUSED"); });
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs(),
      http,
      timer: immediateTimer(),
      ownUid: OWN_UID,
    });

    const outcome = await client.emit(VALID_EVENT);
    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE);
  });

  it("returns timed-out when the total budget elapses before the response settles", async () => {
    let elapsed = 0;
    const timer: EndpointClientTimer = {
      now: () => elapsed,
      setTimeout: (fn) => { queueMicrotask(() => { elapsed = ENDPOINT_CLIENT_LIMITS.TOTAL_BUDGET_MS + 1; fn(); }); return 1; },
      clearTimeout: () => undefined,
    };
    const { http } = stubHttp(() => new Promise(() => undefined));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs(),
      http,
      timer,
      ownUid: OWN_UID,
    });

    const outcome = await client.emit(VALID_EVENT);
    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.TIMED_OUT);
  });

  it("returns unavailable when reading the endpoint file consumes the entire budget", async () => {
    let elapsed = 0;
    const timer: EndpointClientTimer = {
      now: () => elapsed,
      setTimeout: (fn) => { queueMicrotask(() => { elapsed = ENDPOINT_CLIENT_LIMITS.TOTAL_BUDGET_MS + 1; fn(); }); return 1; },
      clearTimeout: () => undefined,
    };
    const { http, recorded } = stubHttp(() => ({ status: 204 }));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: () => new Promise((resolve) => queueMicrotask(() => resolve(endpointJson()))) }),
      http,
      timer,
      ownUid: OWN_UID,
    });

    const outcome = await client.emit(VALID_EVENT);
    expect(outcome).toBe(ENDPOINT_CLIENT_OUTCOME.TIMED_OUT);
    expect(recorded).toHaveLength(0);
  });

  it("reads the endpoint file from the fixed runtime child of the plugin root", async () => {
    let observedPath = "";
    const { http } = stubHttp(() => ({ status: 204 }));
    const client = createEndpointClient({
      pluginRoot: PLUGIN_ROOT,
      fs: stubFs({ readFile: async (path) => { observedPath = path; return endpointJson(); } }),
      http,
      timer: immediateTimer(),
      ownUid: OWN_UID,
    });

    await client.emit(VALID_EVENT);
    expect(observedPath).toBe("/plugin/root/runtime/endpoint.json");
  });
});
