export const MAX_CANONICAL_PROFILE_ARCHIVE_BYTES: number;
export const CANONICAL_PROFILE_ARCHIVE_BYTES: number;
export const CANONICAL_PROFILE_ARCHIVE_SHA256: string;
/** Validates the exact generated delivery artifact, not arbitrary user-edited profiles. */
export function validateProfileArchive(bytes: Uint8Array): Promise<void>;
