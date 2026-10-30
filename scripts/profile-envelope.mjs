import { createHash } from "node:crypto";

export const MAX_CANONICAL_PROFILE_ARCHIVE_BYTES = 64 * 1024;
export const CANONICAL_PROFILE_ARCHIVE_BYTES = 1093;
export const CANONICAL_PROFILE_ARCHIVE_SHA256 = "845e28eacd25979aa90fc19f2b072f0167499a83d1e4c2d64902a92da2b547f3";

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
