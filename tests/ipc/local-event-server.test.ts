import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { describe, expect, it } from "vitest";

import {
  LOCAL_EVENT_SERVER_ERROR,
  LOCAL_EVENT_SERVER_PROTOCOL,
  startLocalEventServer,
  type LocalEventServerHandle,
  type LocalEventServerOptions,
} from "../../src/ipc/local-event-server";
import { LOCAL_AGENT_EVENT_LIMITS, SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";

const TOKEN = "a".repeat(48);
const SENTINEL = "TOKEN_PROMPT_ERROR_SENTINEL";
const EVENT_ID = "de305d54-75b4-431b-adb2-eb6b9e546014";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const TEST_LOGGER = { error: () => undefined };

interface Response {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(reason: unknown): void;
}

interface SendOptions {
  readonly method?: string;
  readonly path?: string;
  readonly authorization?: string;
  readonly omitAuthorization?: boolean;
  readonly contentType?: string;
  readonly body?: string;
  readonly chunked?: boolean;
}

function event(): Record<string, unknown> {
  return {
    schemaVersion: LOCAL_AGENT_EVENT_LIMITS.SCHEMA_VERSION, eventId: EVENT_ID, source: "opencode",
    sessionId: SESSION_ID, timestamp: 1, lifecycle: SESSION_STATUS.RUNNING,
    target: { tmuxPaneId: "%2", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
  };
}

function send(handle: LocalEventServerHandle, options: SendOptions = {}): Promise<Response> {
  const body = options.body ?? JSON.stringify(event());
  return new Promise((resolve, reject) => {
    const client = request({ host: handle.address, port: handle.port, method: options.method ?? "POST", path: options.path ?? "/v1/events", headers: {
       ...(options.omitAuthorization ? {} : { Authorization: options.authorization ?? `Bearer ${TOKEN}` }),
      "Content-Type": options.contentType ?? "application/json",
      ...(options.chunked ? {} : { "Content-Length": Buffer.byteLength(body) }),
    } }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { responseBody += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: responseBody }));
    });
    client.on("error", reject);
    if (options.chunked) { client.write(body.slice(0, 16)); client.end(body.slice(16)); } else client.end(body);
  });
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 250;
    const check = (): void => {
      if (predicate()) { resolve(); return; }
      if (--attempts === 0) { reject(new Error("Timed out waiting for loopback state.")); return; }
      setTimeout(check, 0);
    };
    check();
  });
}

function openSocket(handle: LocalEventServerHandle): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: handle.address, port: handle.port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function authorizationPayload(handle: LocalEventServerHandle, authorization: readonly string[]): string {
  const body = JSON.stringify(event());
  return `POST /v1/events HTTP/1.1\r\nHost: ${handle.address}\r\n${authorization.map((value) => `Authorization: ${value}`).join("\r\n")}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
}

function rawSocketPayload(handle: LocalEventServerHandle, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: handle.address, port: handle.port }); let response = "";
    socket.setEncoding("utf8"); socket.on("data", (chunk: string) => { response += chunk; });
    socket.once("error", reject); socket.once("close", () => resolve(response));
    socket.once("connect", () => socket.end(payload));
  });
}

async function server(onEvent: (value: LocalAgentStatusEvent) => Promise<void> | void = () => undefined,
  overrides: Partial<Omit<LocalEventServerOptions, "token" | "onEvent">> = {}): Promise<LocalEventServerHandle> {
  return startLocalEventServer({ token: TOKEN, onEvent, ...overrides, logger: overrides.logger ?? TEST_LOGGER });
}

function expectOpaque(response: Response): void {
  expect(response.body).not.toContain(SENTINEL);
  expect(JSON.stringify(response.headers)).not.toContain(SENTINEL);
  expect(`${response.body}${JSON.stringify(response.headers)}`).not.toContain(TOKEN);
  expect(response.body).toBe("");
}

describe("local loopback event server", () => {
  it("binds only IPv4 loopback on an ephemeral port and delivers an isolated event", async () => {
    const received: LocalAgentStatusEvent[] = [];
    const handle = await server((value) => { received.push(value); });
    try {
      const response = await send(handle);
      expect(handle.address).toBe(LOCAL_EVENT_SERVER_PROTOCOL.LOOPBACK_HOST);
      expect(handle.port).toBeGreaterThan(0);
      expect(Object.isFrozen(handle)).toBe(true);
      expect(response.status).toBe(204);
      expect(received).toHaveLength(1);
      expect(Object.getPrototypeOf(received[0])).toBeNull();
      expect(Object.getPrototypeOf(received[0]?.target)).toBeNull();
      expect(Object.isFrozen(received[0])).toBe(true);
      expect(Object.isFrozen(received[0]?.target)).toBe(true);
    } finally { await handle.close(); }
  });

  it("rejects authentication failures without exposing supplied values", async () => {
    const handle = await server();
    try {
      for (const authorization of ["Basic token", `bearer ${TOKEN}`, "Bearer", "Bearer ", `Bearer ${TOKEN} extra`,
        "Bearer bad", `Bearer ${TOKEN}${SENTINEL}`, `Bearer ${"b".repeat(LOCAL_EVENT_SERVER_PROTOCOL.MAX_TOKEN_LENGTH + 1)}`]) {
        const response = await send(handle, { authorization });
        expect(response.status).toBe(401);
        expectOpaque(response);
      }
      const missing = await send(handle, { omitAuthorization: true });
      expect(missing.status).toBe(401); expectOpaque(missing);
    } finally { await handle.close(); }
  });

  it("rejects duplicate or comma-joined authorization headers over raw HTTP", async () => {
    const errors: string[] = []; const handle = await server(undefined, { logger: { error: (error) => { errors.push(error); } } });
    try {
      for (const values of [[`Bearer ${TOKEN}`, `Bearer ${TOKEN}`], [`Bearer ${TOKEN}`, "Basic ignored"], [`Bearer ${TOKEN}, Basic ignored`]]) {
        const response = await rawSocketPayload(handle, authorizationPayload(handle, values));
        expect(response).toContain("401"); expect(response).not.toContain(SENTINEL); expect(response).not.toContain(TOKEN);
      }
      const malformed = await rawSocketPayload(handle, `BROKEN ${TOKEN} ${SENTINEL}\r\n\r\n`);
      expect(malformed).toContain("400"); expect(malformed).not.toContain(SENTINEL); expect(malformed).not.toContain(TOKEN); expect(errors).toEqual([LOCAL_EVENT_SERVER_ERROR.CLIENT_ERROR]);
    } finally { await handle.close(); }
  });

  it("enforces opaque protocol and event validation failures", async () => {
    const received: LocalAgentStatusEvent[] = [];
    const handle = await server((value) => { received.push(value); });
    try {
      const cases = [
        [{ path: "/wrong" }, 404], [{ method: "GET" }, 405], [{ contentType: "text/plain" }, 415],
        [{ body: "{" }, 400], [{ body: JSON.stringify({ ...event(), prompt: SENTINEL }) }, 400],
      ] as const;
      for (const [options, status] of cases) {
        const response = await send(handle, options);
        expect(response.status).toBe(status);
        expectOpaque(response);
      }
      expect(received).toHaveLength(0);
    } finally { await handle.close(); }
  });

  it("rejects declared and streamed oversized bodies before callback delivery", async () => {
    const received: LocalAgentStatusEvent[] = [];
    const handle = await server((value) => { received.push(value); });
    const oversized = `${JSON.stringify(event())}${"x".repeat(LOCAL_EVENT_SERVER_PROTOCOL.MAX_BODY_BYTES)}`;
    try {
      for (const chunked of [false, true]) {
        const response = await send(handle, { body: oversized, chunked });
        expect(response.status).toBe(413);
        expectOpaque(response);
      }
      expect(received).toHaveLength(0);
    } finally { await handle.close(); }
  });

  it("contains callback rejection without exposing values", async () => {
    const rejected = await server(async () => { throw new Error(SENTINEL); });
    try {
      const response = await send(rejected);
      expect(response.status).toBe(503);
      expectOpaque(response);
    } finally { await rejected.close(); }
  });

  it("keeps two callbacks in flight until both independently settle", async () => {
    const first = deferred(); const second = deferred(); let entered = 0;
    const handle = await server(() => [first, second][entered++]?.promise ?? Promise.resolve());
    try {
      const responses = [send(handle), send(handle)];
      await waitFor(() => entered === 2);
      first.resolve(); second.resolve();
      expect((await Promise.all(responses)).map((response) => response.status)).toEqual([204, 204]);
    } finally { await handle.close(); }
  });

  it("bounds hung callbacks, contains late rejection, and contains logger failure", async () => {
    const pending = deferred(); const errors: string[] = []; let calls = 0; const unhandled = () => { throw new Error("unhandled"); };
    process.on("unhandledRejection", unhandled);
    const handle = await server(() => { calls += 1; return calls === 1 ? pending.promise : undefined; }, {
      callbackDeadlineMs: 10, maxInFlightCallbacks: 1, logger: { error: (code) => { errors.push(code); throw new Error(SENTINEL); } },
    });
    let pendingResponse: Promise<Response> | undefined;
    try {
      pendingResponse = send(handle);
      const response = await pendingResponse;
      expect(response.status).toBe(503); expectOpaque(response);
      expect((await send(handle)).status).toBe(503); expect(calls).toBe(1);
      pending.reject(new Error(SENTINEL)); await Promise.resolve(); await Promise.resolve();
      expect((await send(handle)).status).toBe(204); expect(calls).toBe(2);
      expect(errors).toEqual([LOCAL_EVENT_SERVER_ERROR.CALLBACK_UNAVAILABLE, LOCAL_EVENT_SERVER_ERROR.CALLBACK_UNAVAILABLE]);
    } finally { void pendingResponse?.catch(() => undefined); process.off("unhandledRejection", unhandled); await handle.close(); }
  });

  it("recovers fresh callback capacity only through a new local server after a hung callback", async () => {
    const pending = deferred();
    const initial = await server(() => pending.promise, { callbackDeadlineMs: 10, maxInFlightCallbacks: 1 });
    try {
      expect((await send(initial)).status).toBe(503);
      expect((await send(initial)).status).toBe(503);
    } finally {
      await initial.close();
      pending.resolve();
    }

    const replacement = await server();
    try {
      expect((await send(replacement)).status).toBe(204);
    } finally {
      await replacement.close();
    }
  });

  it("rejects excess valid requests until pending callbacks settle and closes idempotently", async () => {
    const pending = deferred(); const closing = deferred(); const errors: string[] = []; let calls = 0;
    const handle = await server(() => { calls += 1; return calls === 1 ? pending.promise : calls === 2 ? closing.promise : undefined; }, {
      maxInFlightCallbacks: 1, callbackDeadlineMs: 30, logger: { error: (error) => { errors.push(error); } },
    });
    try {
      const first = send(handle); await waitFor(() => calls === 1);
      expect((await send(handle)).status).toBe(503); expect(calls).toBe(1);
      pending.resolve(); expect((await first).status).toBe(204);
      const third = send(handle); await waitFor(() => calls === 2);
      await Promise.all([handle.close(), handle.close()]);
      await expect(third).rejects.toThrow(); closing.reject(new Error(SENTINEL));
      await new Promise((resolve) => { setTimeout(resolve, 40); }); expect(errors).toEqual([LOCAL_EVENT_SERVER_ERROR.CALLBACK_UNAVAILABLE]);
      await expect(send(handle)).rejects.toThrow();
    } finally { await handle.close(); }
  });

  it("bounds real loopback sockets at the named connection maximum", async () => {
    const handle = await server();
    const maximum = LOCAL_EVENT_SERVER_PROTOCOL.MAX_CONNECTIONS;
    expect(maximum).toBeGreaterThan(0);
    const admitted = await Promise.all(Array.from({ length: maximum }, () => openSocket(handle)));
    const excess = connect({ host: handle.address, port: handle.port });
    try {
      await new Promise<void>((resolve) => { excess.once("close", resolve); excess.once("error", resolve); });
      expect(excess.destroyed).toBe(true);
    } finally { admitted.forEach((socket) => socket.destroy()); await handle.close(); }
  });
});
