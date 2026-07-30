import { chmod, lstat, mkdtemp, mkdir, open, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEndpointDiscoveryPublisher,
  ENDPOINT_DISCOVERY_PROTOCOL,
  ENDPOINT_DISCOVERY_SECURITY,
  generateEndpointToken,
  publishEndpointRecord,
} from "../../src/ipc/endpoint-discovery";

const TOKEN = "a".repeat(48);

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ai-deck-endpoint-"));
}

async function withDirectory(test: (directory: string) => Promise<void>): Promise<void> {
  const directory = await temporaryDirectory();
  try { await test(directory); } finally { await rm(directory, { force: true, recursive: true }); }
}

function options(pluginRoot: string, overrides: Partial<{ address: string; port: number; token: string; pid: number }> = {}) {
  return { pluginRoot, address: "127.0.0.1", port: 43123, token: TOKEN, pid: 123, ...overrides };
}

async function mode(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o777;
}

describe("endpoint discovery", () => {
  it("generates independent high-entropy bearer tokens compatible with C1", () => {
    const tokens = Array.from({ length: 12 }, generateEndpointToken);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(ENDPOINT_DISCOVERY_PROTOCOL.MIN_TOKEN_LENGTH);
      expect(token.length).toBeLessThanOrEqual(ENDPOINT_DISCOVERY_PROTOCOL.MAX_TOKEN_LENGTH);
    }
    expect(ENDPOINT_DISCOVERY_SECURITY.RUNTIME_DIRECTORY).toBe("runtime");
    expect(ENDPOINT_DISCOVERY_SECURITY.SAME_UID_THREAT_MODEL).toContain("outside");
  });

  it("derives a private runtime child under a trusted plugin root and publishes an immutable exact-shape record", async () => {
    await withDirectory(async (directory) => {
      const handle = await publishEndpointRecord(options(directory));
      const runtimeDirectory = join(directory, "runtime"); const endpoint = join(runtimeDirectory, "endpoint.json");
      expect(handle.record).toEqual({ schemaVersion: 1, address: "127.0.0.1", port: 43123, token: TOKEN, pid: 123 });
      expect(Object.isFrozen(handle.record)).toBe(true);
      expect(handle.path).toBe(join(await realpath(directory), "runtime", "endpoint.json"));
      expect(JSON.parse(await readFile(endpoint, "utf8"))).toEqual(handle.record);
      expect((await readdir(runtimeDirectory)).sort()).toEqual(["endpoint.json"]);
      if (process.platform !== "win32") {
        expect(await mode(runtimeDirectory)).toBe(0o700);
        expect(await mode(endpoint)).toBe(0o600);
      }
    });
  });

  it("replaces stale regular and endpoint symlink records without modifying a symlink target", async () => {
    await withDirectory(async (directory) => {
      const runtimeDirectory = join(directory, "runtime");
      const target = join(directory, "target");
      await mkdir(runtimeDirectory); await writeFile(target, "sentinel");
      await writeFile(join(runtimeDirectory, "endpoint.json"), "stale");
      const first = await publishEndpointRecord(options(directory));
      expect(JSON.parse(await readFile(first.path, "utf8"))).toEqual(first.record);
      await unlink(join(runtimeDirectory, "endpoint.json"));
      await symlink(target, join(runtimeDirectory, "endpoint.json"));
      const second = await publishEndpointRecord(options(directory));
      expect((await lstat(second.path)).isSymbolicLink()).toBe(false);
      expect(await readFile(target, "utf8")).toBe("sentinel");
    });
  });

  it("rejects symlinked plugin roots and derived runtime directories without mutating their targets", async () => {
    await withDirectory(async (directory) => {
      const target = join(directory, "target"); const linkedRoot = join(directory, "linked-root");
      await mkdir(target); await writeFile(join(target, "sentinel"), "unchanged"); await symlink(target, linkedRoot);
      await expect(publishEndpointRecord(options(linkedRoot))).rejects.toThrow("Unable to publish endpoint record.");
      expect(await readFile(join(target, "sentinel"), "utf8")).toBe("unchanged");
      expect((await readdir(target)).sort()).toEqual(["sentinel"]);

      const runtimeTarget = join(directory, "runtime-target");
      await mkdir(runtimeTarget); await writeFile(join(runtimeTarget, "sentinel"), "unchanged"); await symlink(runtimeTarget, join(directory, "runtime"));
      await expect(publishEndpointRecord(options(directory))).rejects.toThrow("Unable to publish endpoint record.");
      expect(await readFile(join(runtimeTarget, "sentinel"), "utf8")).toBe("unchanged");
    });
  });

  it("rejects group-writable roots and a simulated foreign-owned root before creating runtime", async () => {
    if (process.platform === "win32" || process.getuid === undefined) return;
    await withDirectory(async (directory) => {
      await chmod(directory, 0o777);
      await expect(publishEndpointRecord(options(directory))).rejects.toThrow("Unable to publish endpoint record.");
      await chmod(directory, 0o700);

      const publisher = createEndpointDiscoveryPublisher({
        lstat: async (path) => {
          const details = await lstat(path);
          return path === directory ? new Proxy(details, { get: (target, key, receiver) => key === "uid" ? target.uid + 1 : Reflect.get(target, key, receiver) }) : details;
        },
      });
      await expect(publisher(options(directory))).rejects.toThrow("Unable to publish endpoint record.");
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("rejects invalid values with fixed errors that reveal no values or paths", async () => {
    await withDirectory(async (directory) => {
      const secret = "TOKEN_PATH_SENTINEL";
      const invalid: ReadonlyArray<Partial<{ address: string; port: number; token: string; pid: number }>> = [
        { address: "localhost" }, { port: 0 }, { port: 1.5 }, { port: 65_536 }, { pid: 0 }, { pid: 1.5 }, { pid: Number.MAX_SAFE_INTEGER + 1 },
        { token: `${secret} bad` }, { token: "a".repeat(ENDPOINT_DISCOVERY_PROTOCOL.MIN_TOKEN_LENGTH - 1) }, { token: "a".repeat(ENDPOINT_DISCOVERY_PROTOCOL.MAX_TOKEN_LENGTH + 1) },
      ];
      for (const overrides of invalid) {
        const failure = publishEndpointRecord(options(join(directory, secret), overrides));
        await expect(failure).rejects.toThrow("Invalid endpoint discovery configuration.");
        await expect(failure).rejects.not.toThrow(secret);
      }
      await expect(publishEndpointRecord(undefined as never)).rejects.toThrow("Invalid endpoint discovery configuration.");
      await expect(publishEndpointRecord({ ...options(directory), pluginRoot: "" })).rejects.toThrow("Invalid endpoint discovery configuration.");
      await expect(publishEndpointRecord({ ...options(directory), pluginRoot: 42 } as never)).rejects.toThrow("Invalid endpoint discovery configuration.");
    });
  });

  it("leaves the stale endpoint intact when later publishers replace it", async () => {
    await withDirectory(async (directory) => {
      const first = await publishEndpointRecord(options(directory));
      expect(JSON.parse(await readFile(first.path, "utf8"))).toEqual(first.record);
      const older = await publishEndpointRecord(options(directory, { token: "b".repeat(48) }));
      const newer = await publishEndpointRecord(options(directory, { token: "c".repeat(48) }));
      expect(JSON.parse(await readFile(newer.path, "utf8"))).toEqual(newer.record);
      expect(older.record.token).not.toBe(newer.record.token);
    });
  });

  it("observes only the prior record before rename and the complete new record after release", async () => {
    await withDirectory(async (directory) => {
      const endpoint = join(directory, "runtime", "endpoint.json");
      const prior = await publishEndpointRecord(options(directory));
      const renameEntered = deferred(); const releaseRename = deferred();
      const publisher = createEndpointDiscoveryPublisher({
        rename: async (temporary, destination) => {
          renameEntered.resolve();
          await releaseRename.promise;
          await rename(temporary, destination);
        },
      });
      const next = publisher(options(directory, { token: "b".repeat(48) }));
      await renameEntered.promise;
      expect(JSON.parse(await readFile(endpoint, "utf8"))).toEqual(prior.record);
      releaseRename.resolve();
      expect(JSON.parse(await readFile((await next).path, "utf8"))).toEqual((await next).record);
    });
  });

  it("cleans temporary files after write, chmod, sync, and rename failures without replacing a prior endpoint", async () => {
    await withDirectory(async (directory) => {
      const runtimeDirectory = join(directory, "runtime"); await mkdir(runtimeDirectory);
      const endpoint = join(runtimeDirectory, "endpoint.json"); await writeFile(endpoint, "prior");
      for (const step of ["write", "chmod", "sync", "rename"] as const) {
        const publisher = step === "rename"
          ? createEndpointDiscoveryPublisher({ rename: async () => { throw new Error("forced"); } })
          : createEndpointDiscoveryPublisher({ open: async (path, flags, mode) => failingHandle(await open(path, flags, mode), step) });
        await expect(publisher(options(directory))).rejects.toThrow("Unable to publish endpoint record.");
        expect(await readFile(endpoint, "utf8")).toBe("prior");
        expect((await readdir(runtimeDirectory)).sort()).toEqual(["endpoint.json"]);
      }
    });
  });
});

function failingHandle(handle: FileHandle, step: "write" | "chmod" | "sync" | "rename") {
  return {
    writeFile: step === "write" ? async () => { throw new Error("forced"); } : handle.writeFile.bind(handle),
    chmod: step === "chmod" ? async () => { throw new Error("forced"); } : handle.chmod.bind(handle),
    sync: step === "sync" ? async () => { throw new Error("forced"); } : handle.sync.bind(handle),
    close: handle.close.bind(handle),
  };
}
