import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_SLOT_ACTION_UUID } from "../src/actions/session-slot.constants";

const streamDeckMock = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  loggerError: vi.fn(),
  registerAction: vi.fn(),
}));
const runtimeMock = vi.hoisted(() => ({
  unregister: vi.fn(),
  registerLifecycle: vi.fn<() => () => void>(),
  start: vi.fn<() => Promise<{ stop(): Promise<void> }>>(),
  stop: vi.fn<() => Promise<void>>(),
}));
const VALID_LAUNCH_ARGUMENTS = [
  process.execPath, "plugin.js", "-port", "28174", "-pluginUUID", "com.gentleman.ai-deck", "-registerEvent", "registerPlugin", "-info", "{\"application\":{}}",
];
const LAUNCH_PARAMETER_ERROR = "AI Deck launch parameter error.";

vi.mock("@elgato/streamdeck", () => ({
  default: {
    actions: { registerAction: streamDeckMock.registerAction },
    connect: streamDeckMock.connect,
    logger: { error: streamDeckMock.loggerError },
    ui: {
      onDidAppear: vi.fn(),
      onDidDisappear: vi.fn(),
      onSendToPlugin: vi.fn(),
    },
  },
}));

vi.mock("../src/actions/session-slot", () => ({
  SessionSlotAction: class {},
}));
vi.mock("../src/plugin/runtime", () => ({
  registerPluginRuntimeProcessLifecycle: runtimeMock.registerLifecycle,
  startPluginRuntime: runtimeMock.start,
  derivePluginRootFromBundledModuleUrl: () => "/mock/plugin/root",
}));

interface PackageManifest {
  engines: PackageEngines;
  scripts: PackageScripts;
}

interface PackageEngines {
  node: string;
}

interface PackageScripts {
  build: string;
  test: string;
  typecheck: string;
}

describe("Stream Deck plugin scaffold", () => {
  const originalExitCode = process.exitCode;
  const originalArgv = process.argv;

  beforeEach(() => {
    process.exitCode = undefined;
    process.argv = [...VALID_LAUNCH_ARGUMENTS];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.clearAllMocks();
    runtimeMock.stop.mockResolvedValue(undefined);
    runtimeMock.start.mockResolvedValue({ stop: runtimeMock.stop });
    runtimeMock.registerLifecycle.mockReturnValue(runtimeMock.unregister);
    vi.resetModules();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("pins Node 24 and foundation quality commands", async () => {
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as PackageManifest;

    expect(packageManifest.engines.node).toBe("24.x");
    expect(packageManifest.scripts).toMatchObject({
      build: "node scripts/build-plugin.mjs",
      "build:rollup": "rollup -c",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    });
  });

  it("exports the session-slot action UUID", () => {
    expect(SESSION_SLOT_ACTION_UUID).toBe("com.gentleman.ai-deck.session-slot");
  });

  it("starts the local runtime, registers the action, and then connects exactly once", async () => {
    streamDeckMock.connect.mockResolvedValue(undefined);

    await import("../src/plugin");

    expect(streamDeckMock.registerAction).toHaveBeenCalledOnce();
    expect(runtimeMock.start).toHaveBeenCalledBefore(streamDeckMock.registerAction);
    expect(streamDeckMock.registerAction).toHaveBeenCalledBefore(streamDeckMock.connect);
    expect(streamDeckMock.connect).toHaveBeenCalledOnce();
  });

  it("logs and exits non-zero when the Stream Deck connection fails", async () => {
    const connectionError = new Error("TOKEN_PATH_EVENT_SENTINEL");
    streamDeckMock.connect.mockRejectedValue(connectionError);

    await import("../src/plugin");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runtimeMock.stop).toHaveBeenCalledOnce();
    expect(runtimeMock.unregister).toHaveBeenCalledOnce();
    expect(streamDeckMock.loggerError).toHaveBeenCalledWith("Stream Deck connection failed.");
    expect(console.error).toHaveBeenCalledWith("Stream Deck connection failed.");
    expect(JSON.stringify(streamDeckMock.loggerError.mock.calls)).not.toContain("TOKEN_PATH_EVENT_SENTINEL");
    expect(process.exitCode).toBe(1);
  });

  it("contains rejected runtime startup and a throwing SDK logger before action registration or connect", async () => {
    const sentinel = "TOKEN_PATH_EVENT_SENTINEL";
    runtimeMock.start.mockRejectedValue(new Error(sentinel));
    streamDeckMock.loggerError.mockImplementation(() => { throw new Error(sentinel); });

    await import("../src/plugin");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(streamDeckMock.registerAction).not.toHaveBeenCalled();
    expect(streamDeckMock.connect).not.toHaveBeenCalled();
    expect(streamDeckMock.loggerError).toHaveBeenCalledWith("AI Deck local runtime startup failed.");
    expect(console.error).toHaveBeenCalledWith("AI Deck local runtime startup failed.");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(streamDeckMock.loggerError.mock.calls)).not.toContain(sentinel);
    expect(process.exitCode).toBe(1);
  });

  it("rejects malformed host launch arguments before any runtime mutation", async () => {
    const sentinel = "TOKEN_PATH_EVENT_SENTINEL";
    const cases = [
      [process.execPath, "plugin.js"],
      [process.execPath, "plugin.js", "-port"],
      [process.execPath, "plugin.js", "-port", "-pluginUUID", "value", "-registerEvent", "event", "-info", "{}"],
      [process.execPath, "plugin.js", "-port", "0", "-pluginUUID", "value", "-registerEvent", "event", "-info", "{}"],
      [process.execPath, "plugin.js", "-port", "65536", "-pluginUUID", "value", "-registerEvent", "event", "-info", "{}"],
      [process.execPath, "plugin.js", "-port", "not-a-port", "-pluginUUID", "value", "-registerEvent", "event", "-info", "{}"],
      [process.execPath, "plugin.js", "-port", "28174", "-pluginUUID", "value", "-registerEvent", "event", "-info", "{"],
      [process.execPath, "plugin.js", "-port", "28174", "-pluginUUID", "value", "-registerEvent", "event", "-info", `["${sentinel}"]`],
    ];
    for (const args of cases) {
      vi.clearAllMocks(); vi.resetModules(); process.exitCode = undefined; process.argv = args;
      await import("../src/plugin");
      expect(streamDeckMock.registerAction).not.toHaveBeenCalled();
      expect(runtimeMock.start).not.toHaveBeenCalled();
      expect(streamDeckMock.connect).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(LAUNCH_PARAMETER_ERROR);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sentinel);
      expect(process.exitCode).toBe(1);
    }
  });
});
