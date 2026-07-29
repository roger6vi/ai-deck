import { createHash } from "node:crypto";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import pluginManifest from "../com.gentleman.ai-deck.sdPlugin/manifest.json" with { type: "json" };
// Stream Deck profiles are ZIP files whose root directory ends in .sdProfile.
const PROFILE_FILE_EXTENSION = ".streamDeckProfile";
const PROFILE_ARCHIVE_DIRECTORY_EXTENSION = ".sdProfile";
const PROFILE_MANIFEST_FILE_NAME = "manifest.json";
const PROFILE_PAGES_DIRECTORY_NAME = "Profiles";
const ZIP_MIME_TYPE = "application/zip";
// Page folder names encode the UUID as padded five-hex-digit groups in base 32.
const FOLDER_HEX_GROUP_PATTERN = /.{5}/g;
const FOLDER_HEX_GROUP_RADIX = 16;
const FOLDER_ENCODING_RADIX = 32;
const FOLDER_INPUT_PADDING = "000";
const FOLDER_ENCODED_GROUP_LENGTH = 4;
const FOLDER_ID_LENGTH = 26;
const FOLDER_SUFFIX = "Z";
// Stable action IDs derive from SHA-256(action UUID + coordinate) with UUID v5/RFC 4122 bits.
const ACTION_ID_UUID_VERSION = "5";
const ACTION_ID_UUID_VARIANT = "8";
const ACTION_ID_HASH_SLICES = Object.freeze({
  timeLow: [0, 8],
  timeMid: [8, 12],
  timeHigh: [13, 16],
  clockSequence: [17, 20],
  node: [20, 32],
});
export const PLUGIN_DIRECTORY = "com.gentleman.ai-deck.sdPlugin";
export const PROFILE_NAME = "Local Agent Status";
export const PROFILE_FILE = `${PLUGIN_DIRECTORY}/${PROFILE_PAGES_DIRECTORY_NAME}/${PROFILE_NAME}${PROFILE_FILE_EXTENSION}`;
export const SESSION_SLOT_ACTION_UUID = pluginManifest.Actions[0].UUID;
export const SESSION_SLOT_COORDINATES = Object.freeze(["0,0", "1,0", "2,0", "3,0", "4,0"]);
export const PROFILE_PAGE_ID = "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9";
export const PROFILE_DEVICE_MODEL = "20GAA9901";
export const PROFILE_ROOT_UUID = "8E61C791-8708-42EA-9891-1554B6F0B5B8";
export const PROFILE_FORMAT_VERSION = "2.0";
export const RESERVED_ACTION_NAME = "Reserved Session Slot";
function profileFolderId(pageId) {
  const paddedHex = pageId.replaceAll("-", "") + FOLDER_INPUT_PADDING;
  const hexGroups = paddedHex.match(FOLDER_HEX_GROUP_PATTERN) ?? [];
  const encodedGroups = hexGroups.map((group) =>
    Number.parseInt(group, FOLDER_HEX_GROUP_RADIX)
      .toString(FOLDER_ENCODING_RADIX)
      .padStart(FOLDER_ENCODED_GROUP_LENGTH, "0"),
  );
  const encodedFolder = encodedGroups.join("").slice(0, FOLDER_ID_LENGTH).toUpperCase();

  return encodedFolder.replaceAll("V", "W").replaceAll("U", "V") + FOLDER_SUFFIX;
}
const profileRoot = `${PROFILE_ROOT_UUID}${PROFILE_ARCHIVE_DIRECTORY_EXTENSION}`;
export const PROFILE_ENTRY_NAMES = Object.freeze([
  `${profileRoot}/${PROFILE_MANIFEST_FILE_NAME}`,
  `${profileRoot}/${PROFILE_PAGES_DIRECTORY_NAME}/${profileFolderId(PROFILE_PAGE_ID)}/${PROFILE_MANIFEST_FILE_NAME}`,
]);
export function stableActionId(coordinate) {
  const hash = createHash("sha256")
    .update(`${SESSION_SLOT_ACTION_UUID}:${coordinate}`)
    .digest("hex");
  return `${hash.slice(...ACTION_ID_HASH_SLICES.timeLow)}-${hash.slice(...ACTION_ID_HASH_SLICES.timeMid)}-${ACTION_ID_UUID_VERSION}${hash.slice(...ACTION_ID_HASH_SLICES.timeHigh)}-${ACTION_ID_UUID_VARIANT}${hash.slice(...ACTION_ID_HASH_SLICES.clockSequence)}-${hash.slice(...ACTION_ID_HASH_SLICES.node)}`;
}

export async function readProfileArchive(bytes) {
  const archive = new ZipReader(new BlobReader(new Blob([bytes], { type: ZIP_MIME_TYPE })));
  const entries = await archive.getEntries();
  const names = entries.map((entry) => entry.filename);
  if (names.length !== PROFILE_ENTRY_NAMES.length || !PROFILE_ENTRY_NAMES.every((name) => names.includes(name))) {
    throw new Error("Profile archive entry topology is invalid.");
  }
  const manifests = await Promise.all(
    PROFILE_ENTRY_NAMES.map(async (name) => {
      const entry = entries.find((candidate) => candidate.filename === name);
      if (!entry || !("getData" in entry)) throw new Error(`Profile archive is missing ${name}.`);
      return JSON.parse(await entry.getData(new TextWriter()));
    }),
  );
  await archive.close();
  return { manifests, names };
}
