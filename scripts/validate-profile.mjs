import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_PROFILE_ARCHIVE_BYTES,
  MAX_CANONICAL_PROFILE_ARCHIVE_BYTES,
  validateProfileArchive,
} from "./profile-envelope.mjs";

const defaultProfilePath = fileURLToPath(
  new URL("../com.gentleman.ai-deck.sdPlugin/Profiles/Local%20Agent%20Status.streamDeckProfile", import.meta.url),
);
const profilePath = process.argv[2] ?? defaultProfilePath;

const FILE_OPERATIONS = { lstat, open };
const { O_NONBLOCK, O_RDONLY } = fsConstants;

function assertRegularFile(metadata) {
  if (!metadata.isFile() || metadata.isSymbolicLink?.()) {
    throw new Error("Profile archive must be a regular file.");
  }
}

function assertBoundedSize(size) {
  if (size > MAX_CANONICAL_PROFILE_ARCHIVE_BYTES) {
    throw new Error("Profile archive exceeds the maximum byte limit.");
  }
  if (size !== CANONICAL_PROFILE_ARCHIVE_BYTES) {
    throw new Error("Profile archive does not match the canonical byte length.");
  }
}

export async function validateProfileFile(path, operations = FILE_OPERATIONS) {
  const initialMetadata = await operations.lstat(path);
  assertRegularFile(initialMetadata);
  if (initialMetadata.size > MAX_CANONICAL_PROFILE_ARCHIVE_BYTES) {
    throw new Error("Profile archive exceeds the maximum byte limit.");
  }
  const handle = await operations.open(path, O_RDONLY | O_NONBLOCK);
  let primaryError;
  try {
    const metadata = await handle.stat();
    assertRegularFile(metadata);
    assertBoundedSize(metadata.size);
    const bytes = new Uint8Array(CANONICAL_PROFILE_ARCHIVE_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (bytesRead !== CANONICAL_PROFILE_ARCHIVE_BYTES) {
      throw new Error("Profile archive does not match the canonical byte length.");
    }
    await validateProfileArchive(bytes.subarray(0, bytesRead));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (!primaryError) throw error;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await validateProfileFile(profilePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
