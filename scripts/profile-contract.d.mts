export const PROFILE_FILE: string;
export const SESSION_SLOT_ACTION_UUID: string;
export function readProfileArchive(bytes: ArrayBuffer | Uint8Array): Promise<{
  manifests: unknown[];
  names: string[];
}>;
