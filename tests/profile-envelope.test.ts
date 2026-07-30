import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateProfileArchive } from "../scripts/profile-envelope.mjs";
import { validateProfileFile } from "../scripts/validate-profile.mjs";

const CANONICAL_PROFILE_SIZE = 1099;
const CANONICAL_PROFILE_SHA256 = "2e18701273a17ba81c3f8d72aa5a3c4a0b7912ace4e7271fe3f243a213199a50";
const MAX_PROFILE_SIZE = 64 * 1024;
const { O_NONBLOCK, O_RDONLY } = fsConstants;
const PROFILE_PATH = new URL("../com.gentleman.ai-deck.sdPlugin/Profiles/Local%20Agent%20Status.streamDeckProfile", import.meta.url);
const ENVELOPE_PATH = new URL("../scripts/profile-envelope.mjs", import.meta.url);
const CLI_PATH = fileURLToPath(new URL("../scripts/validate-profile.mjs", import.meta.url));
const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

interface MockHandle {
  close: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
}

function patchByte(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes);
  result[0] = (result[0] ?? 0) ^ 0xff;
  return result;
}

function regularStat(size: number) {
  return { isFile: () => true, isSymbolicLink: () => false, size };
}

function mockHandle(bytes: Uint8Array, bytesRead = bytes.byteLength): MockHandle {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockImplementation(async (buffer: Uint8Array) => {
      buffer.set(bytes.subarray(0, bytesRead));
      return { bytesRead };
    }),
    stat: vi.fn().mockResolvedValue(regularStat(bytes.byteLength)),
  };
}

function fileOperations(handle: MockHandle, initialStat = regularStat(CANONICAL_PROFILE_SIZE)) {
  return {
    lstat: vi.fn().mockResolvedValue(initialStat),
    open: vi.fn().mockResolvedValue(handle),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("canonical profile delivery envelope", () => {
  it("accepts the exact committed artifact", async () => {
    const bytes = await readFile(PROFILE_PATH);

    expect(bytes.byteLength).toBe(CANONICAL_PROFILE_SIZE);
    await expect(validateProfileArchive(bytes)).resolves.toBeUndefined();
  });

  it.each([
    ["non-Uint8Array", null as unknown as Uint8Array, "Uint8Array"],
    ["one byte short", new Uint8Array(CANONICAL_PROFILE_SIZE - 1), "canonical byte length"],
    ["one byte long", new Uint8Array(CANONICAL_PROFILE_SIZE + 1), "canonical byte length"],
    ["oversized", new Uint8Array(MAX_PROFILE_SIZE + 1), "maximum byte limit"],
  ])("rejects %s with a precise envelope error", async (_name, bytes, message) => {
    await expect(validateProfileArchive(bytes)).rejects.toThrow(message);
  });

  it("rejects a same-length hash mutation", async () => {
    await expect(validateProfileArchive(patchByte(await readFile(PROFILE_PATH)))).rejects.toThrow("SHA-256");
  });

  it("has no ZIP or parser surface", async () => {
    const source = await readFile(ENVELOPE_PATH, "utf8");

    expect(source).not.toContain("zip.js");
    expect(source).not.toContain("JSON.parse");
    expect(source).toContain(CANONICAL_PROFILE_SHA256);
  });

  it("runs the CLI from another cwd and fails visibly for an explicit invalid path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-deck-envelope-"));
    temporaryDirectories.push(directory);
    const invalidProfile = join(directory, "invalid.streamDeckProfile");
    await writeFile(invalidProfile, "invalid");

    await expect(executeFile(process.execPath, [CLI_PATH], { cwd: directory })).resolves.toMatchObject({ stderr: "" });
    await expect(executeFile(process.execPath, [CLI_PATH, invalidProfile], { cwd: directory })).rejects.toMatchObject({ code: 1 });
  });
});

describe("bounded canonical profile file loading", () => {
  it.each([
    ["symlink", { isFile: () => true, isSymbolicLink: () => true, size: CANONICAL_PROFILE_SIZE }],
    ["FIFO", { isFile: () => false, isSymbolicLink: () => false, size: 0 }],
  ])("rejects lstat %s before opening", async (_name, initialStat) => {
    const operations = fileOperations(mockHandle(new Uint8Array()), initialStat);

    await expect(validateProfileFile("unsafe", operations)).rejects.toThrow("regular file");
    expect(operations.open).not.toHaveBeenCalled();
  });

  it("opens nonblocking and rejects post-open type and size races", async () => {
    const nonregular = mockHandle(new Uint8Array(CANONICAL_PROFILE_SIZE));
    nonregular.stat.mockResolvedValue({ isFile: () => false, size: CANONICAL_PROFILE_SIZE });
    const oversized = mockHandle(new Uint8Array(CANONICAL_PROFILE_SIZE));
    oversized.stat.mockResolvedValue(regularStat(CANONICAL_PROFILE_SIZE + 1));

    for (const handle of [nonregular, oversized]) {
      const operations = fileOperations(handle);
      await expect(validateProfileFile("raced", operations)).rejects.toThrow();
      expect(operations.open).toHaveBeenCalledWith("raced", O_RDONLY | O_NONBLOCK);
      expect(handle.read).not.toHaveBeenCalled();
      expect(handle.close).toHaveBeenCalledTimes(1);
    }
  });

  it("bounds positional reads and rejects a growing file", async () => {
    const bytes = await readFile(PROFILE_PATH);
    const handle = mockHandle(new Uint8Array(CANONICAL_PROFILE_SIZE + 1), CANONICAL_PROFILE_SIZE + 1);
    handle.stat.mockResolvedValue(regularStat(CANONICAL_PROFILE_SIZE));
    const operations = fileOperations(handle, regularStat(bytes.byteLength));

    await expect(validateProfileFile("growing", operations)).rejects.toThrow("canonical byte length");
    expect(handle.read).toHaveBeenCalledWith(expect.any(Uint8Array), 0, CANONICAL_PROFILE_SIZE + 1, 0);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("closes on success and preserves primary failures over close failures", async () => {
    const canonical = await readFile(PROFILE_PATH);
    const success = mockHandle(canonical);
    const validationFailure = mockHandle(patchByte(canonical));
    validationFailure.close.mockRejectedValue(new Error("close failed"));
    const closeFailure = mockHandle(canonical);
    closeFailure.close.mockRejectedValue(new Error("close failed"));

    await expect(validateProfileFile("success", fileOperations(success))).resolves.toBeUndefined();
    await expect(validateProfileFile("validation", fileOperations(validationFailure))).rejects.toThrow("SHA-256");
    await expect(validateProfileFile("close", fileOperations(closeFailure))).rejects.toThrow("close failed");
    for (const handle of [success, validationFailure, closeFailure]) expect(handle.close).toHaveBeenCalledTimes(1);
  });
});
