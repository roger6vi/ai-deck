import { createHash } from "node:crypto";

export const MAX_CANONICAL_PROFILE_ARCHIVE_BYTES = 64 * 1024;
export const CANONICAL_PROFILE_ARCHIVE_BYTES = 1102;
export const CANONICAL_PROFILE_ARCHIVE_SHA256 = "42227f7286a1855096d9f7eed3e6608652183fa40bf16ada6a5c3c788cebe9ec";

/** Validates the exact generated delivery artifact, not arbitrary user-edited profiles. */
export async function validateProfileArchive(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Profile archive must be a Uint8Array.");
  }
  if (bytes.byteLength > MAX_CANONICAL_PROFILE_ARCHIVE_BYTES) {
    throw new Error("Profile archive exceeds the maximum byte limit.");
  }
  if (bytes.byteLength !== CANONICAL_PROFILE_ARCHIVE_BYTES) {
    throw new Error("Profile archive does not match the canonical byte length.");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== CANONICAL_PROFILE_ARCHIVE_SHA256) {
    throw new Error("Profile archive does not match the canonical SHA-256 hash.");
  }
}
