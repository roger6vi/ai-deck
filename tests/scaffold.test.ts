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

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("pins Node 24 and foundation quality commands", async () => {
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as PackageManifest;

    expect(packageManifest.engines.node).toBe("24.x");
    expect(packageManifest.scripts).toMatchObject({
      build: "rollup -c",
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
    expect(process.exitCode).toBe(1);
  });
});
