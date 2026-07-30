import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_SLOT_ACTION_UUID } from "../src/actions/session-slot.constants";

const streamDeckMock = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  loggerError: vi.fn(),
  registerAction: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => ({
  default: {
    actions: { registerAction: streamDeckMock.registerAction },
    connect: streamDeckMock.connect,
    logger: { error: streamDeckMock.loggerError },
  },
}));

vi.mock("../src/actions/session-slot", () => ({
  SessionSlotAction: class {},
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
    process.argv = [
      process.execPath,
      "plugin.js",
      "-port",
      "0",
      "-pluginUUID",
      "test-plugin",
      "-registerEvent",
      "registerPlugin",
      "-info",
      "{}",
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.clearAllMocks();
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

  it("registers the session-slot action before connecting", async () => {
    streamDeckMock.connect.mockResolvedValue(undefined);

    await import("../src/plugin");

    expect(streamDeckMock.registerAction).toHaveBeenCalledBefore(streamDeckMock.connect);
  });

  it("logs and exits non-zero when the Stream Deck connection fails", async () => {
    const connectionError = new Error("connection refused");
    streamDeckMock.connect.mockRejectedValue(connectionError);

    await import("../src/plugin");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(streamDeckMock.loggerError).toHaveBeenCalledWith("Stream Deck connection failed.", connectionError);
    expect(console.error).toHaveBeenCalledWith("AI Deck launch parameter error:", "connection refused");
    expect(process.exitCode).toBe(1);
  });

  it("fails visibly before connecting when host launch parameters are absent", async () => {
    process.argv = [process.execPath, "plugin.js"];

    await import("../src/plugin");

    expect(streamDeckMock.registerAction).not.toHaveBeenCalled();
    expect(streamDeckMock.connect).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "AI Deck launch parameter error: Unable to establish a connection with Stream Deck, missing command line arguments: -port, -pluginUUID, -registerEvent, -info",
    );
    expect(process.exitCode).toBe(1);
  });
});
