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

export function isDirectCliInvocation(moduleUrl: string, entryPath: string | undefined, cwd: string = process.cwd()): boolean {
  if (entryPath === undefined) return false;
  return resolve(cwd, entryPath) === resolve(fileURLToPath(moduleUrl));
}
