import { readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

import { parseLocalAgentStatusEvent } from "../core/events";
import type { LocalAgentStatusEvent } from "../core/types";

export const ENDPOINT_CLIENT_LIMITS = {
  TOTAL_BUDGET_MS: 200,
  MAX_ENDPOINT_FILE_BYTES: 4 * 1024,
  MIN_TOKEN_LENGTH: 32,
  MAX_TOKEN_LENGTH: 256,
  MIN_PORT: 1,
  MAX_PORT: 65_535,
  ENDPOINT_MODE_FORBIDDEN_MASK: 0o077,
} as const;

export const ENDPOINT_CLIENT_OUTCOME = {
  EMITTED: "emitted",
  UNAVAILABLE: "unavailable",
  REJECTED: "rejected",
  TIMED_OUT: "timed-out",
  LOCAL_ERROR: "local-error",
} as const;

export type EndpointClientOutcome = (typeof ENDPOINT_CLIENT_OUTCOME)[keyof typeof ENDPOINT_CLIENT_OUTCOME];

export interface EndpointClientFilesystem {
  readFile(path: string): Promise<string>;
  stat(path: string): Promise<{ readonly mode: number; readonly uid: number }>;
}

export interface EndpointClientHttpRequest {
  readonly host: string;
  readonly port: number;
  readonly method: "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface EndpointClientHttp {
  request(request: EndpointClientHttpRequest, body: string): Promise<{ readonly status: number }>;
}

export interface EndpointClientTimer {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EndpointClientOptions {
  readonly pluginRoot: string;
  readonly fs: EndpointClientFilesystem;
  readonly http: EndpointClientHttp;
  readonly timer: EndpointClientTimer;
  readonly ownUid: number;
  readonly budgetMs?: number;
}

export interface EndpointClient {
  emit(event: LocalAgentStatusEvent): Promise<EndpointClientOutcome>;
}

const ENDPOINT_FILE_PATH_SEGMENTS = ["runtime", "endpoint.json"] as const;
const ENDPOINT_RECORD_ALLOWED_FIELDS = ["schemaVersion", "address", "port", "token", "pid"] as const;
const ENDPOINT_LOOPBACK_ADDRESS = "127.0.0.1";
const ENDPOINT_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENDPOINT_EVENT_PATH = "/v1/events";
const ENDPOINT_CONTENT_TYPE = "application/json";
const TIMEOUT_SENTINEL: unique symbol = Symbol("endpoint-client-timeout");

interface EndpointRecord {
  readonly address: string;
  readonly port: number;
  readonly token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function parseEndpointRecord(contents: string): EndpointRecord | undefined {
  if (contents.length > ENDPOINT_CLIENT_LIMITS.MAX_ENDPOINT_FILE_BYTES) return undefined;
  let value: unknown;
  try { value = JSON.parse(contents); } catch { return undefined; }
  if (!isRecord(value)) return undefined;
  const ownFields = Reflect.ownKeys(value);
  if (ownFields.length !== ENDPOINT_RECORD_ALLOWED_FIELDS.length) return undefined;
  for (const field of ownFields) {
    if (typeof field !== "string" || !ENDPOINT_RECORD_ALLOWED_FIELDS.includes(field as (typeof ENDPOINT_RECORD_ALLOWED_FIELDS)[number])) return undefined;
  }
  const { schemaVersion, address, port, token, pid } = value;
  if (
    schemaVersion !== 1 ||
    address !== ENDPOINT_LOOPBACK_ADDRESS ||
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    port < ENDPOINT_CLIENT_LIMITS.MIN_PORT ||
    port > ENDPOINT_CLIENT_LIMITS.MAX_PORT ||
    typeof token !== "string" ||
    token.length < ENDPOINT_CLIENT_LIMITS.MIN_TOKEN_LENGTH ||
    token.length > ENDPOINT_CLIENT_LIMITS.MAX_TOKEN_LENGTH ||
    !ENDPOINT_TOKEN_PATTERN.test(token) ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid < 0
  ) return undefined;
  return { address, port, token };
}

function isSecureStat(stat: { readonly mode: number; readonly uid: number }, ownUid: number): boolean {
  return stat.uid === ownUid && (stat.mode & ENDPOINT_CLIENT_LIMITS.ENDPOINT_MODE_FORBIDDEN_MASK) === 0;
}

function mapHttpStatus(status: number): EndpointClientOutcome {
  if (status === 204) return ENDPOINT_CLIENT_OUTCOME.EMITTED;
  if (status >= 400 && status < 500) return ENDPOINT_CLIENT_OUTCOME.REJECTED;
  return ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE;
}

async function raceWithDeadline<T>(operation: Promise<T>, deadline: Promise<typeof TIMEOUT_SENTINEL>): Promise<T | typeof TIMEOUT_SENTINEL> {
  return Promise.race([operation, deadline]);
}

const NODE_FILESYSTEM: EndpointClientFilesystem = {
  readFile: (path) => readFile(path, { encoding: "utf8" }),
  stat: async (path) => {
    const stats = await stat(path);
    return { mode: stats.mode, uid: stats.uid };
  },
};

const NODE_HTTP: EndpointClientHttp = {
  request: (options, body) => new Promise((resolve, reject) => {
    const request = httpRequest({
      host: options.host,
      port: options.port,
      method: options.method,
      path: options.path,
      headers: options.headers,
      timeout: options.timeoutMs,
    }, (response) => {
      response.on("data", () => undefined);
      response.on("end", () => resolve({ status: response.statusCode ?? 0 }));
    });
    request.on("error", reject);
    request.on("timeout", () => { request.destroy(new Error("endpoint request timed out")); });
    request.write(body);
    request.end();
  }),
};

const NODE_TIMER: EndpointClientTimer = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createEndpointClient(options: EndpointClientOptions): EndpointClient {
  const budgetMs = options.budgetMs ?? ENDPOINT_CLIENT_LIMITS.TOTAL_BUDGET_MS;
  const endpointPath = join(options.pluginRoot, ...ENDPOINT_FILE_PATH_SEGMENTS);

  return {
    async emit(event) {
      let normalized: LocalAgentStatusEvent;
      try { normalized = parseLocalAgentStatusEvent(event); } catch { return ENDPOINT_CLIENT_OUTCOME.REJECTED; }

      const start = options.timer.now();
      let deadlineHandle: unknown;
      const deadlinePromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        deadlineHandle = options.timer.setTimeout(() => resolve(TIMEOUT_SENTINEL), budgetMs);
      });

      try {
        const contents = await raceWithDeadline(options.fs.readFile(endpointPath), deadlinePromise);
        if (contents === TIMEOUT_SENTINEL) return ENDPOINT_CLIENT_OUTCOME.TIMED_OUT;

        const attributes = await raceWithDeadline(options.fs.stat(endpointPath), deadlinePromise);
        if (attributes === TIMEOUT_SENTINEL) return ENDPOINT_CLIENT_OUTCOME.TIMED_OUT;
        if (!isSecureStat(attributes, options.ownUid)) return ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE;

        const record = parseEndpointRecord(contents);
        if (record === undefined) return ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE;

        const elapsed = options.timer.now() - start;
        const remainingMs = budgetMs - elapsed;
        if (remainingMs <= 0) return ENDPOINT_CLIENT_OUTCOME.TIMED_OUT;

        const httpRequestOptions: EndpointClientHttpRequest = {
          host: record.address,
          port: record.port,
          method: "POST",
          path: ENDPOINT_EVENT_PATH,
          headers: {
            authorization: `Bearer ${record.token}`,
            "content-type": ENDPOINT_CONTENT_TYPE,
          },
          timeoutMs: remainingMs,
        };
        const body = JSON.stringify(normalized);

        const response = await raceWithDeadline(options.http.request(httpRequestOptions, body), deadlinePromise);
        if (response === TIMEOUT_SENTINEL) return ENDPOINT_CLIENT_OUTCOME.TIMED_OUT;

        return mapHttpStatus(response.status);
      } catch {
        return ENDPOINT_CLIENT_OUTCOME.UNAVAILABLE;
      } finally {
        options.timer.clearTimeout(deadlineHandle);
      }
    },
  };
}

export const productionEndpointClientDependencies = {
  fs: NODE_FILESYSTEM,
  http: NODE_HTTP,
  timer: NODE_TIMER,
} as const;
