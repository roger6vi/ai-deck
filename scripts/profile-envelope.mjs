import { createHash } from "node:crypto";

export const MAX_CANONICAL_PROFILE_ARCHIVE_BYTES = 64 * 1024;
export const CANONICAL_PROFILE_ARCHIVE_BYTES = 1099;
export const CANONICAL_PROFILE_ARCHIVE_SHA256 = "2e18701273a17ba81c3f8d72aa5a3c4a0b7912ace4e7271fe3f243a213199a50";

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
