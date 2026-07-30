import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";

import { parseLocalAgentStatusEvent } from "../core/events";
import type { LocalAgentStatusEvent } from "../core/types";

export const LOCAL_EVENT_SERVER_PROTOCOL = {
  LOOPBACK_HOST: "127.0.0.1",
  MIN_TOKEN_LENGTH: 32,
  MAX_TOKEN_LENGTH: 256,
  MAX_HEADERS: 32,
  MAX_CONNECTIONS: 2,
  MAX_BODY_BYTES: 8 * 1024,
  HEADERS_TIMEOUT_MS: 5_000,
  REQUEST_TIMEOUT_MS: 10_000,
  KEEP_ALIVE_TIMEOUT_MS: 1_000,
  CALLBACK_DEADLINE_MS: 100,
  MAX_IN_FLIGHT_CALLBACKS: 2,
  HTTP_STATUS: {
    ACCEPTED: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    SERVICE_UNAVAILABLE: 503,
  },
} as const;

export const LOCAL_EVENT_SERVER_ERROR = {
  CALLBACK_UNAVAILABLE: "LOCAL_EVENT_CALLBACK_UNAVAILABLE",
  CLIENT_ERROR: "LOCAL_EVENT_CLIENT_ERROR",
} as const;
export type LocalEventServerError = (typeof LOCAL_EVENT_SERVER_ERROR)[keyof typeof LOCAL_EVENT_SERVER_ERROR];

const EVENT_PATH = "/v1/events";
const JSON_CONTENT_TYPE = "application/json";
const INVALID_CONFIGURATION_MESSAGE = "Invalid local event server configuration.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface LocalEventServerLogger {
  error(code: LocalEventServerError): void;
}

export interface LocalEventServerOptions {
  readonly token: string;
  readonly onEvent: (event: LocalAgentStatusEvent) => Promise<void> | void;
  readonly callbackDeadlineMs?: number;
  readonly maxInFlightCallbacks?: number;
  readonly logger: LocalEventServerLogger;
}

export interface LocalEventServerHandle {
  readonly address: string;
  readonly port: number;
  close(): Promise<void>;
}

function isSafeToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= LOCAL_EVENT_SERVER_PROTOCOL.MIN_TOKEN_LENGTH &&
    token.length <= LOCAL_EVENT_SERVER_PROTOCOL.MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(token);
}

function hasToken(values: readonly string[] | undefined, expected: Buffer): boolean {
  const authorization = values?.length === 1 ? values[0] ?? "" : "";
  const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  const sameLength = supplied.length === expected.length;
  return timingSafeEqual(expected, sameLength ? supplied : expected) && sameLength;
}

function send(response: ServerResponse, status: number, close = false): void {
  if (response.writableEnded) return;
  response.shouldKeepAlive = !close;
  response.writeHead(status, close ? { Connection: "close" } : undefined).end();
}

function hasJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.split(";", 1)[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

function hasOversizedLength(request: IncomingMessage): boolean {
  const value = request.headers["content-length"];
  return typeof value === "string" && /^\d+$/.test(value) && Number(value) > LOCAL_EVENT_SERVER_PROTOCOL.MAX_BODY_BYTES;
}

function configure(server: Server): void {
  server.headersTimeout = LOCAL_EVENT_SERVER_PROTOCOL.HEADERS_TIMEOUT_MS;
  server.requestTimeout = LOCAL_EVENT_SERVER_PROTOCOL.REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = LOCAL_EVENT_SERVER_PROTOCOL.KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = LOCAL_EVENT_SERVER_PROTOCOL.MAX_HEADERS;
  server.maxConnections = LOCAL_EVENT_SERVER_PROTOCOL.MAX_CONNECTIONS;
}

export async function startLocalEventServer(options: LocalEventServerOptions): Promise<LocalEventServerHandle> {
  const deadline = options.callbackDeadlineMs ?? LOCAL_EVENT_SERVER_PROTOCOL.CALLBACK_DEADLINE_MS;
  const capacity = options.maxInFlightCallbacks ?? LOCAL_EVENT_SERVER_PROTOCOL.MAX_IN_FLIGHT_CALLBACKS;
  if (!isSafeToken(options.token) || typeof options.onEvent !== "function" || typeof options.logger?.error !== "function" || !Number.isSafeInteger(deadline) || deadline <= 0 || !Number.isSafeInteger(capacity) || capacity <= 0) throw new Error(INVALID_CONFIGURATION_MESSAGE);
  const token = Buffer.from(options.token);
  const sockets = new Set<Socket>();
  const callbackTimers = new Set<NodeJS.Timeout>();
  let inFlight = 0;
  let closed = false;
  const report = (error: LocalEventServerError): void => {
    try { options.logger.error(error); } catch {}
  };
  const unavailable = (response: ServerResponse): void => {
    report(LOCAL_EVENT_SERVER_ERROR.CALLBACK_UNAVAILABLE);
    send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.SERVICE_UNAVAILABLE);
  };
  const invoke = (event: LocalAgentStatusEvent, response: ServerResponse): void => {
    if (inFlight >= capacity) { unavailable(response); return; }
    inFlight += 1;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; unavailable(response); }, deadline);
    callbackTimers.add(timer);
    const settle = (status: number): void => {
      clearTimeout(timer); callbackTimers.delete(timer); inFlight -= 1;
      if (!timedOut && !closed) {
        if (status === LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.SERVICE_UNAVAILABLE) report(LOCAL_EVENT_SERVER_ERROR.CALLBACK_UNAVAILABLE);
        send(response, status);
      }
    };
    Promise.resolve().then(() => options.onEvent(event)).then(
      () => settle(LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.ACCEPTED),
      () => settle(LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.SERVICE_UNAVAILABLE),
    );
  };
  const server = createServer((request, response) => {
    if (request.url !== EVENT_PATH) { send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.NOT_FOUND); return; }
    if (request.method !== "POST") { send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.METHOD_NOT_ALLOWED); return; }
    if (!hasToken(request.headersDistinct.authorization, token)) { send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.UNAUTHORIZED); return; }
    if (!hasJsonContentType(request)) { send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE); return; }
    if (hasOversizedLength(request)) { request.resume(); send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.PAYLOAD_TOO_LARGE, true); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > LOCAL_EVENT_SERVER_PROTOCOL.MAX_BODY_BYTES) {
        rejected = true;
        request.pause();
        send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.PAYLOAD_TOO_LARGE, true);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      let event: LocalAgentStatusEvent;
      try {
        event = parseLocalAgentStatusEvent(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.BAD_REQUEST);
        return;
      }
      invoke(event, response);
    });
    request.on("error", () => { send(response, LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.BAD_REQUEST, true); });
  });
  configure(server);
  server.on("connection", (socket) => {
    if (sockets.size >= LOCAL_EVENT_SERVER_PROTOCOL.MAX_CONNECTIONS) { socket.destroy(); return; }
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (error, socket) => {
    void error;
    report(LOCAL_EVENT_SERVER_ERROR.CLIENT_ERROR);
    socket.end(`HTTP/1.1 ${LOCAL_EVENT_SERVER_PROTOCOL.HTTP_STATUS.BAD_REQUEST} Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOCAL_EVENT_SERVER_PROTOCOL.LOOPBACK_HOST, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string" || address.family !== "IPv4" || address.address !== LOCAL_EVENT_SERVER_PROTOCOL.LOOPBACK_HOST) { server.close(); throw new Error(INVALID_CONFIGURATION_MESSAGE); }
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= new Promise((resolve) => {
    closed = true;
    for (const timer of callbackTimers) clearTimeout(timer);
    callbackTimers.clear();
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  });
  return Object.freeze({ address: address.address, port: address.port, close });
}
