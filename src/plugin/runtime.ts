import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalAgentStatusEvent } from "../core/types";
import {
  generateEndpointToken,
  publishEndpointRecord,
  type EndpointDiscoveryHandle,
  type EndpointDiscoveryOptions,
} from "../ipc/endpoint-discovery";
import {
  startLocalEventServer,
  type LocalEventServerHandle,
  type LocalEventServerOptions,
} from "../ipc/local-event-server";
import { sessionSlotController } from "./session-slot-controller";

export const PLUGIN_RUNTIME_LOG_MESSAGE = {
  STARTUP_FAILED: "AI Deck local runtime startup failed.",
  EVENT_FAILED: "AI Deck local runtime event failed.",
} as const;

export interface PluginRuntimeClock {
  now(): number;
}

export interface PluginRuntimeLogger {
  error(message: string): void;
}

export interface PluginRuntimeController {
  handleStatusEvent(event: LocalAgentStatusEvent, now: number): Promise<void>;
  dispose(): void;
}

export interface PluginRuntimeHandle {
  readonly address: string;
  readonly port: number;
  readonly pid: number;
  stop(): Promise<void>;
}

export interface PluginRuntimeOptions {
  readonly pluginRoot?: string;
  readonly clock?: PluginRuntimeClock;
  readonly logger?: PluginRuntimeLogger;
  readonly controller?: PluginRuntimeController;
  readonly pid?: number;
  readonly startServer?: (options: LocalEventServerOptions) => Promise<LocalEventServerHandle>;
  readonly publishEndpoint?: (options: EndpointDiscoveryOptions) => Promise<EndpointDiscoveryHandle>;
}

export interface PluginRuntimeSignalProcess {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  kill(pid: number, signal: "SIGINT" | "SIGTERM"): void;
}

const productionClock: PluginRuntimeClock = { now: Date.now };
const productionLogger: PluginRuntimeLogger = { error: (message) => console.error(message) };
const lifecycleRegistrations = new WeakMap<PluginRuntimeHandle, WeakMap<object, () => void>>();

function report(logger: PluginRuntimeLogger, message: string): void {
  try { logger.error(message); } catch {}
}

async function rollbackRuntime(controller: PluginRuntimeController, server?: LocalEventServerHandle): Promise<void> {
  const cleanup = [Promise.resolve().then(() => controller.dispose())];
  if (server !== undefined) cleanup.push(server.close());
  await Promise.allSettled(cleanup);
}

export function derivePluginRootFromBundledModuleUrl(moduleUrl: string): string {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

export async function startPluginRuntime(options: PluginRuntimeOptions = {}): Promise<PluginRuntimeHandle> {
  const clock = options.clock ?? productionClock;
  const logger = options.logger ?? productionLogger;
  const controller = options.controller ?? sessionSlotController;
  const pid = options.pid ?? process.pid;
  const token = generateEndpointToken();
  const startServer = options.startServer ?? startLocalEventServer;
  const publishEndpoint = options.publishEndpoint ?? publishEndpointRecord;
  let server: LocalEventServerHandle;
  try {
    server = await startServer({ token, logger: { error: () => report(logger, PLUGIN_RUNTIME_LOG_MESSAGE.EVENT_FAILED) }, onEvent: (event) => controller.handleStatusEvent(event, clock.now()) });
  } catch {
    await rollbackRuntime(controller);
    report(logger, PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
    throw new Error(PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
  }
  try {
    await publishEndpoint({ pluginRoot: options.pluginRoot ?? derivePluginRootFromBundledModuleUrl(import.meta.url), address: server.address, port: server.port, token, pid });
  } catch {
    await rollbackRuntime(controller, server);
    report(logger, PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
    throw new Error(PLUGIN_RUNTIME_LOG_MESSAGE.STARTUP_FAILED);
  }
  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => shutdown ??= (async () => {
    controller.dispose();
    await server.close();
  })();
  return Object.freeze({ address: server.address, port: server.port, pid, stop });
}

export function registerPluginRuntimeProcessLifecycle(runtime: PluginRuntimeHandle, signalProcess: PluginRuntimeSignalProcess = process): () => void {
  const registrations = lifecycleRegistrations.get(runtime) ?? new WeakMap<object, () => void>();
  lifecycleRegistrations.set(runtime, registrations);
  const existing = registrations.get(signalProcess);
  if (existing !== undefined) return existing;
  let disposed = false;
  let terminating = false;
  const unregister = (): void => {
    if (disposed) return;
    disposed = true;
    signalProcess.off("SIGINT", onInterrupt); signalProcess.off("SIGTERM", onTerminate);
    registrations.delete(signalProcess);
  };
  const terminate = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (terminating) return;
    terminating = true;
    unregister();
    try {
      await runtime.stop();
    } catch {
      // Termination must continue even when best-effort runtime cleanup fails.
    } finally {
      signalProcess.kill(process.pid, signal);
    }
  };
  const onInterrupt = (): void => { void terminate("SIGINT"); };
  const onTerminate = (): void => { void terminate("SIGTERM"); };
  signalProcess.once("SIGINT", onInterrupt); signalProcess.once("SIGTERM", onTerminate);
  registrations.set(signalProcess, unregister);
  return unregister;
}
