import { connect } from "node:net";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { SESSION_STATUS, type LocalAgentStatusEvent } from "../../src/core/types";
import {
  PLUGIN_RUNTIME_LOG_MESSAGE,
  derivePluginRootFromBundledModuleUrl,
  registerPluginRuntimeProcessLifecycle,
  startPluginRuntime,
} from "../../src/plugin/runtime";

const EVENT = {
  schemaVersion: 1,
  eventId: "de305d54-75b4-431b-adb2-eb6b9e546014",
  source: "opencode",
  sessionId: "123e4567-e89b-42d3-a456-426614174000",
  timestamp: 1,
  lifecycle: SESSION_STATUS.RUNNING,
  target: { tmuxPaneId: "%2", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" },
} as const;

interface FakeSignalProcess {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  kill(pid: number, signal: "SIGINT" | "SIGTERM"): void;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-deck-runtime-"));
  await chmod(root, 0o700);
  return root;
}

function post(address: string, port: number, token: string, body = JSON.stringify(EVENT)): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = request({ host: address, port, method: "POST", path: "/v1/events", headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
    } }, (response) => { response.resume(); response.once("end", () => resolve(response.statusCode ?? 0)); });
    client.once("error", reject); client.end(body);
  });
}

function unavailable(address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port });
    socket.once("error", () => resolve()); socket.once("connect", () => { socket.destroy(); reject(new Error("Server remained reachable.")); });
  });
}

describe("plugin runtime bootstrap", () => {
  it("derives the plugin root from the bundled bin entry", () => {
    expect(derivePluginRootFromBundledModuleUrl("file:///Applications/ai-deck.sdPlugin/bin/plugin.js")).toBe("/Applications/ai-deck.sdPlugin");
  });

  it("delivers only C1-normalized authorized events, publishes a private endpoint, and leaves a stale record after stop", async () => {
    const root = await temporaryRoot();
    const received: Array<{ readonly event: LocalAgentStatusEvent; readonly now: number }> = [];
    const controller = { handleStatusEvent: async (event: LocalAgentStatusEvent, now: number) => { received.push({ event, now }); }, dispose: vi.fn() };
    try {
      const runtime = await startPluginRuntime({ pluginRoot: root, clock: { now: () => 42 }, controller });
      const endpointPath = join(root, "runtime", "endpoint.json");
      const record = JSON.parse(await readFile(endpointPath, "utf8")) as { address: string; port: number; token: string; pid: number };
      expect({ address: runtime.address, port: runtime.port, pid: runtime.pid }).toEqual({ address: "127.0.0.1", port: record.port, pid: process.pid });
      expect(Object.keys(runtime)).not.toContain("token");
      expect((await stat(endpointPath)).mode & 0o777).toBe(process.platform === "win32" ? (await stat(endpointPath)).mode & 0o777 : 0o600);
      expect(await post(record.address, record.port, record.token)).toBe(204);
      expect(await post(record.address, record.port, "x".repeat(48))).toBe(401);
      expect(await post(record.address, record.port, record.token, "{")).toBe(400);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ event: EVENT, now: 42 });
      expect(Object.isFrozen(received[0]?.event)).toBe(true);
      await Promise.all([runtime.stop(), runtime.stop()]);
      expect(controller.dispose).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(endpointPath, "utf8"))).toEqual(record);
      await unavailable(record.address, record.port);
      const replacement = await startPluginRuntime({ pluginRoot: root, controller });
      const next = JSON.parse(await readFile(endpointPath, "utf8")) as { port: number; token: string };
       expect(next.port).not.toBe(record.port);
       expect(next.token).not.toBe(record.token);
      await replacement.stop();
    } finally { await rm(root, { force: true, recursive: true }); }
  });

  it("rolls back failed startup with fixed redacted diagnostics", async () => {
    const logs: string[] = []; const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = { handleStatusEvent: async () => undefined, dispose: vi.fn() };
    const failure = new Error("TOKEN_PATH_EVENT_SENTINEL");
    await expect(startPluginRuntime({ logger: { error: (message) => { logs.push(message); } }, controller, startServer: async () => { throw failure; } })).rejects.toThrow(PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
    await expect(startPluginRuntime({ logger: { error: (message) => { logs.push(message); } }, controller, startServer: async () => ({ address: "127.0.0.1", port: 1234, close }), publishEndpoint: async () => { throw failure; } })).rejects.toThrow(PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
    expect(close).toHaveBeenCalledTimes(1); expect(controller.dispose).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED, PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED]);
    expect(JSON.stringify(logs)).not.toContain("TOKEN_PATH_EVENT_SENTINEL");
  });

  it("contains secondary rollback cleanup failure behind the generic startup failure", async () => {
    const logs: string[] = []; const close = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("CLOSE_SENTINEL"));
    const controller = { handleStatusEvent: async () => undefined, dispose: vi.fn() };
    await expect(startPluginRuntime({ logger: { error: (message) => { logs.push(message); } }, controller, startServer: async () => ({ address: "127.0.0.1", port: 1234, close }), publishEndpoint: async () => { throw new Error("DISCOVERY_SENTINEL"); } })).rejects.toThrow(PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
    expect(close).toHaveBeenCalledOnce(); expect(controller.dispose).toHaveBeenCalledOnce();
    expect(logs).toEqual([PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED]);
    expect(JSON.stringify(logs)).not.toMatch(/CLOSE_SENTINEL|DISCOVERY_SENTINEL/);
  });

  it("waits for deferred stop before one original-signal re-emission and ignores duplicates", async () => {
    const stopped = deferred();
    const runtime = { address: "127.0.0.1", port: 1234, pid: 1, stop: vi.fn(() => stopped.promise) };
    const listeners = new Map<string, () => void>(); const terminations: Array<{ readonly pid: number; readonly signal: string }> = [];
    const fakeProcess: FakeSignalProcess = {
      once: (signal, listener) => { listeners.set(signal, listener); },
      off: (signal) => { listeners.delete(signal); },
      kill: (pid, signal) => { terminations.push({ pid, signal }); },
    };
    const unregister = registerPluginRuntimeProcessLifecycle(runtime, fakeProcess);
    expect(registerPluginRuntimeProcessLifecycle(runtime, fakeProcess)).toBe(unregister);
    const terminate = listeners.get("SIGTERM");
    terminate?.(); terminate?.();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(terminations).toEqual([]);
    stopped.resolve();
    await vi.waitFor(() => expect(terminations).toEqual([{ pid: process.pid, signal: "SIGTERM" }]));
    unregister(); expect(terminations).toHaveLength(1);
  });

  it("contains rejected stop and still re-emits exactly one original signal", async () => {
    const stopped = deferred();
    const runtime = { address: "127.0.0.1", port: 1234, pid: 1, stop: vi.fn(() => stopped.promise) };
    const listeners = new Map<string, () => void>(); const terminations: Array<{ readonly pid: number; readonly signal: string }> = [];
    const fakeProcess: FakeSignalProcess = { once: (signal, listener) => { listeners.set(signal, listener); }, off: (signal) => { listeners.delete(signal); }, kill: (pid, signal) => { terminations.push({ pid, signal }); } };
    listeners.set("unhandled", () => { throw new Error("unhandled rejection"); });
    registerPluginRuntimeProcessLifecycle(runtime, fakeProcess);
    listeners.get("SIGINT")?.(); stopped.reject(new Error("stop failed"));
    await vi.waitFor(() => expect(terminations).toEqual([{ pid: process.pid, signal: "SIGINT" }]));
    expect(runtime.stop).toHaveBeenCalledOnce();
  });
});
