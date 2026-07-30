import streamDeck from "@elgato/streamdeck";

import { SessionSlotAction } from "./actions/session-slot";
import { registerPluginRuntimeProcessLifecycle, startPluginRuntime } from "./plugin/runtime";

const LAUNCH_PARAMETERS = {
  PORT: "-port",
  PLUGIN_UUID: "-pluginUUID",
  REGISTER_EVENT: "-registerEvent",
  INFO: "-info",
} as const;
const LAUNCH_PARAMETER_ERROR = "AI Deck launch parameter error.";
const PLUGIN_RUNTIME_STARTUP_ERROR = "AI Deck local runtime startup failed.";
const HOST_PORT = {
  MINIMUM: 1,
  MAXIMUM: 65_535,
} as const;

function optionValue(argumentsList: readonly string[], option: string): string | undefined {
  const index = argumentsList.indexOf(option);
  const value = index < 0 ? undefined : argumentsList[index + 1];
  return value === undefined || value.length === 0 || value.startsWith("-") ? undefined : value;
}

function isPort(value: string | undefined): boolean {
  if (value === undefined || !/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= HOST_PORT.MINIMUM && port <= HOST_PORT.MAXIMUM;
}

function isJsonObject(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function hasValidLaunchParameters(argumentsList: readonly string[]): boolean {
  const port = optionValue(argumentsList, LAUNCH_PARAMETERS.PORT);
  const pluginUuid = optionValue(argumentsList, LAUNCH_PARAMETERS.PLUGIN_UUID);
  const registerEvent = optionValue(argumentsList, LAUNCH_PARAMETERS.REGISTER_EVENT);
  const info = optionValue(argumentsList, LAUNCH_PARAMETERS.INFO);
  return isPort(port) && pluginUuid !== undefined && registerEvent !== undefined && isJsonObject(info);
}

function reportDiagnostic(message: string): void {
  try { console.error(message); } catch {}
  try { streamDeck.logger.error(message); } catch {}
}

export async function launchPlugin(): Promise<void> {
  if (!hasValidLaunchParameters(process.argv)) {
    console.error(LAUNCH_PARAMETER_ERROR);
    process.exitCode = 1;
    return;
  }
  let runtime;
  try {
    runtime = await startPluginRuntime();
  } catch {
    process.exitCode = 1;
    reportDiagnostic(PLUGIN_RUNTIME_STARTUP_ERROR);
    return;
  }
  streamDeck.actions.registerAction(new SessionSlotAction());
  const unregisterLifecycle = registerPluginRuntimeProcessLifecycle(runtime);
  try {
    await streamDeck.connect();
  } catch {
    unregisterLifecycle();
    try { await runtime.stop(); } catch {}
    process.exitCode = 1;
    reportDiagnostic("Stream Deck connection failed.");
  }
}

void launchPlugin();
