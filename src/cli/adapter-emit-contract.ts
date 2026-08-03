import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ADAPTER_EMIT_EXIT_CODE = {
  EMITTED: 0,
  REJECTED: 2,
  UNAVAILABLE: 3,
  TIMED_OUT: 4,
  LOCAL_ERROR: 5,
} as const;

export type AdapterEmitExitCode = (typeof ADAPTER_EMIT_EXIT_CODE)[keyof typeof ADAPTER_EMIT_EXIT_CODE];

/**
 * Node reports `import.meta.url` for the real file, while `argv[1]` keeps the
 * path the caller typed. The Stream Deck plugin directory is commonly a
 * symlink, so both sides are compared through their real paths — otherwise the
 * bundled CLI is a silent no-op when it is invoked through the installed path.
 */
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function isDirectCliInvocation(moduleUrl: string, entryPath: string | undefined, cwd: string = process.cwd()): boolean {
  if (entryPath === undefined) return false;
  return realPathOf(resolve(cwd, entryPath)) === realPathOf(resolve(fileURLToPath(moduleUrl)));
}
