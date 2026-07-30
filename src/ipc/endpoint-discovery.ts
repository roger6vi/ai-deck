import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, join, relative } from "node:path";

export const ENDPOINT_DISCOVERY_PROTOCOL = {
  SCHEMA_VERSION: 1,
  ADDRESS: "127.0.0.1",
  MIN_TOKEN_LENGTH: 32,
  MAX_TOKEN_LENGTH: 256,
  MIN_PORT: 1,
  MAX_PORT: 65_535,
  RUNTIME_DIRECTORY_MODE: 0o700,
  ENDPOINT_FILE_MODE: 0o600,
} as const;

/**
 * The caller supplies an already trusted plugin root; this module creates only
 * its fixed `runtime` child. A malicious process with this process's UID is
 * outside scope: it can already read 0600 files and inspect process state.
 */
export const ENDPOINT_DISCOVERY_SECURITY = {
  RUNTIME_DIRECTORY: "runtime",
  SAME_UID_THREAT_MODEL: "Malicious same-UID processes are outside the path-API threat model.",
} as const;

const ENDPOINT_FILE = "endpoint.json";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const INVALID_CONFIGURATION = "Invalid endpoint discovery configuration.";
const PUBLISH_FAILURE = "Unable to publish endpoint record.";

export interface EndpointRecord {
  readonly schemaVersion: number;
  readonly address: string;
  readonly port: number;
  readonly token: string;
  readonly pid: number;
}

export interface EndpointDiscoveryOptions {
  readonly pluginRoot: string;
  readonly address: string;
  readonly port: number;
  readonly token: string;
  readonly pid: number;
}

export interface EndpointDiscoveryHandle {
  readonly record: EndpointRecord;
  readonly path: string;
}

export interface EndpointDiscoveryFileHandle {
  writeFile(data: string, encoding: BufferEncoding): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface EndpointDiscoveryFilesystem {
  lstat(path: string): Promise<Stats>;
  mkdir(path: string, options: { readonly mode: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: string, mode: number): Promise<EndpointDiscoveryFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const NODE_FILESYSTEM: EndpointDiscoveryFilesystem = {
  lstat: async (path) => lstat(path),
  mkdir: async (path, options) => mkdir(path, options),
  chmod: async (path, mode) => chmod(path, mode),
  realpath: async (path) => realpath(path),
  open: async (path, flags, mode) => open(path, flags, mode),
  rename: async (oldPath, newPath) => rename(oldPath, newPath),
  unlink: async (path) => unlink(path),
};

export function generateEndpointToken(): string {
  return randomBytes(48).toString("base64url");
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function validOptions(options: unknown): options is EndpointDiscoveryOptions {
  if (typeof options !== "object" || options === null) return false;
  const value = options as Record<string, unknown>;
  return hasPluginRoot(value) && hasLoopbackAddress(value) && hasValidPort(value) && hasValidPid(value) && hasValidToken(value);
}

function hasPluginRoot(value: Record<string, unknown>): boolean {
  return typeof value.pluginRoot === "string" && value.pluginRoot.length > 0;
}

function hasLoopbackAddress(value: Record<string, unknown>): boolean {
  return value.address === ENDPOINT_DISCOVERY_PROTOCOL.ADDRESS;
}

function hasValidPort(value: Record<string, unknown>): boolean {
  return typeof value.port === "number" && Number.isSafeInteger(value.port) &&
    value.port >= ENDPOINT_DISCOVERY_PROTOCOL.MIN_PORT && value.port <= ENDPOINT_DISCOVERY_PROTOCOL.MAX_PORT;
}

function hasValidPid(value: Record<string, unknown>): boolean {
  return typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0;
}

function hasValidToken(value: Record<string, unknown>): boolean {
  return typeof value.token === "string" &&
    value.token.length >= ENDPOINT_DISCOVERY_PROTOCOL.MIN_TOKEN_LENGTH &&
    value.token.length <= ENDPOINT_DISCOVERY_PROTOCOL.MAX_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value.token);
}

function isSecureDirectory(details: Stats): boolean {
  if (!details.isDirectory() || details.isSymbolicLink()) return false;
  if (process.platform === "win32") return true;
  const currentUserId = process.getuid?.();
  if (typeof currentUserId === "number" && typeof details.uid === "number" && details.uid !== currentUserId) return false;
  return (details.mode & 0o022) === 0;
}

function isDerivedRuntime(pluginRoot: string, runtimeDirectory: string): boolean {
  return dirname(runtimeDirectory) === pluginRoot && relative(pluginRoot, runtimeDirectory) === ENDPOINT_DISCOVERY_SECURITY.RUNTIME_DIRECTORY;
}

async function secureRuntimeDirectory(pluginRoot: string, filesystem: EndpointDiscoveryFilesystem): Promise<string> {
  try {
    const suppliedRoot = await filesystem.lstat(pluginRoot);
    if (!isSecureDirectory(suppliedRoot)) throw new Error();
    const canonicalRoot = await filesystem.realpath(pluginRoot);
    const canonicalRootDetails = await filesystem.lstat(canonicalRoot);
    if (!isSecureDirectory(canonicalRootDetails)) throw new Error();

    const runtimeDirectory = join(canonicalRoot, ENDPOINT_DISCOVERY_SECURITY.RUNTIME_DIRECTORY);
    try { await filesystem.mkdir(runtimeDirectory, { mode: ENDPOINT_DISCOVERY_PROTOCOL.RUNTIME_DIRECTORY_MODE }); }
    catch (error: unknown) { if (!hasCode(error, "EEXIST")) throw error; }
    const runtimeDetails = await filesystem.lstat(runtimeDirectory);
    if (!runtimeDetails.isDirectory() || runtimeDetails.isSymbolicLink()) throw new Error();
    await filesystem.chmod(runtimeDirectory, ENDPOINT_DISCOVERY_PROTOCOL.RUNTIME_DIRECTORY_MODE);
    const canonicalRuntime = await filesystem.realpath(runtimeDirectory);
    if (!isDerivedRuntime(canonicalRoot, canonicalRuntime)) throw new Error();
    return canonicalRuntime;
  } catch {
    throw new Error(PUBLISH_FAILURE);
  }
}

async function temporaryFile(directory: string, filesystem: EndpointDiscoveryFilesystem): Promise<{ path: string; handle: EndpointDiscoveryFileHandle }> {
  for (;;) {
    const path = join(directory, `.${ENDPOINT_FILE}.${randomBytes(18).toString("base64url")}.tmp`);
    try { return { path, handle: await filesystem.open(path, "wx", ENDPOINT_DISCOVERY_PROTOCOL.ENDPOINT_FILE_MODE) }; }
    catch (error: unknown) { if (!hasCode(error, "EEXIST")) throw error; }
  }
}

async function removeTemporary(path: string | undefined, filesystem: EndpointDiscoveryFilesystem): Promise<void> {
  if (path === undefined) return;
  try { await filesystem.unlink(path); }
  catch (error: unknown) { if (!hasCode(error, "ENOENT")) return; }
}

export function createEndpointDiscoveryPublisher(overrides: Partial<EndpointDiscoveryFilesystem> = {}) {
  const filesystem: EndpointDiscoveryFilesystem = { ...NODE_FILESYSTEM, ...overrides };
  return async (options: EndpointDiscoveryOptions): Promise<EndpointDiscoveryHandle> => {
    if (!validOptions(options)) throw new Error(INVALID_CONFIGURATION);
    const runtimeDirectory = await secureRuntimeDirectory(options.pluginRoot, filesystem);
    const record = Object.freeze({ schemaVersion: ENDPOINT_DISCOVERY_PROTOCOL.SCHEMA_VERSION, address: options.address, port: options.port, token: options.token, pid: options.pid });
    const path = join(runtimeDirectory, ENDPOINT_FILE);
    let temporary: string | undefined;
    try {
      const file = await temporaryFile(runtimeDirectory, filesystem); temporary = file.path;
      try {
        await file.handle.writeFile(JSON.stringify(record), "utf8");
        await file.handle.chmod(ENDPOINT_DISCOVERY_PROTOCOL.ENDPOINT_FILE_MODE); await file.handle.sync();
      } finally { await file.handle.close().catch(() => undefined); }
      await filesystem.rename(temporary, path); temporary = undefined;
    } catch {
      throw new Error(PUBLISH_FAILURE);
    } finally {
      await removeTemporary(temporary, filesystem);
    }

    return Object.freeze({ record, path });
  };
}

export const publishEndpointRecord = createEndpointDiscoveryPublisher();
