#!/usr/bin/env node
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";

export const CURRENT_PLUGIN_UUID = "roger6vi.ai-deck";
// Both identities that shipped under a different plugin UUID, in release order.
export const PREVIOUS_PLUGIN_UUIDS = Object.freeze(["com.gentleman.ai-deck", "io.github.roger6vi.ai-deck"]);

const PROFILE_FILE_EXTENSION = ".streamDeckProfile";
const PROFILE_ARCHIVE_DIRECTORY_EXTENSION = ".sdProfile";
const PROFILE_MANIFEST_FILE_NAME = "manifest.json";
const PROFILE_PAGES_DIRECTORY_NAME = "Profiles";
// Stream Deck wraps multi-action contents in a routine action list under Settings.
const MULTI_ACTION_UUID_PREFIX = "com.elgato.streamdeck.multiactions";
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
// A fixed wall-clock date keeps repacked archives byte-stable across runs.
const FIXED_ARCHIVE_TIMESTAMP = new Date(2026, 0, 1, 0, 0, 0, 0);
const ZIP_COMPRESSION_LEVEL = 6;
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

export const USAGE = `Usage: node scripts/migrate-profile.mjs --input <exported.streamDeckProfile> --output <migrated.streamDeckProfile>

Migrate an exported Stream Deck profile from a previous AI Deck plugin identity
(${PREVIOUS_PLUGIN_UUIDS.join(", ")}) to the current identity (${CURRENT_PLUGIN_UUID}).

  --input <path>   Exported .streamDeckProfile archive to read. Never modified.
  --output <path>  New .streamDeckProfile archive to write. Must not exist yet.
  --help, -h       Show this help and exit.

The command rewrites only action UUID fields that exactly match a previous AI
Deck identity. Action instance IDs, unrelated settings, titles and assets are
preserved. Import the migrated profile with Stream Deck's "Import Profile...";
export and back up your current profiles first.`;

function usageError(message) {
  const error = new Error(message);
  error.exitCode = EXIT_USAGE;
  return error;
}

export function parseArguments(argv) {
  let input;
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument !== "--input" && argument !== "--output") {
      throw usageError(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw usageError(`Missing value for ${argument}`);
    }
    if (argument === "--input") {
      if (input !== undefined) throw usageError("--input was provided more than once");
      input = value;
    } else {
      if (output !== undefined) throw usageError("--output was provided more than once");
      output = value;
    }
    index += 1;
  }
  if (input === undefined) throw usageError("Missing required --input <path>");
  if (output === undefined) throw usageError("Missing required --output <path>");
  return { input, output };
}

function migrationError(message) {
  const error = new Error(message);
  error.exitCode = EXIT_FAILURE;
  return error;
}

function assertProfileExtension(path, label) {
  if (!path.endsWith(PROFILE_FILE_EXTENSION)) {
    throw migrationError(`${label} must end with ${PROFILE_FILE_EXTENSION}: ${path}`);
  }
}

export function migrateIdentity(value) {
  for (const previous of PREVIOUS_PLUGIN_UUIDS) {
    if (value === previous) return CURRENT_PLUGIN_UUID;
    const actionPrefix = `${previous}.`;
    if (value.startsWith(actionPrefix)) return `${CURRENT_PLUGIN_UUID}.${value.slice(actionPrefix.length)}`;
  }
  return value;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Number primitives are replaced by `JSON.rawJSON` copies of their original
 * tokens, so stringify cannot round large integers, `-0`, or exponent spelling
 * through IEEE-754. No custom parser is involved.
 */
export function preserveNumericTokens(_key, value, context) {
  return typeof value === "number" ? JSON.rawJSON(context.source) : value;
}

/** Only `<root>.sdProfile/manifest.json` and `<root>.sdProfile/Profiles/<page>/manifest.json`. */
function isProfileManifestEntry(filename, root) {
  const segments = filename.split("/");
  if (segments[0] !== root) return false;
  if (segments.length === 2) return segments[1] === PROFILE_MANIFEST_FILE_NAME;
  return (
    segments.length === 4 &&
    segments[1] === PROFILE_PAGES_DIRECTORY_NAME &&
    segments[2] !== undefined &&
    segments[2] !== "" &&
    segments[3] === PROFILE_MANIFEST_FILE_NAME
  );
}

/**
 * Only genuine Stream Deck action containers are inspected. User settings are
 * never traversed, so identity-looking values inside them survive verbatim.
 */
function migrateActionNode(action, counter) {
  if (!isPlainObject(action)) return;
  if (typeof action.UUID === "string") {
    const migrated = migrateIdentity(action.UUID);
    if (migrated !== action.UUID) {
      action.UUID = migrated;
      counter.count += 1;
    }
  }
  // Nested actions exist only inside a recognized multi-action routine.
  if (typeof action.UUID !== "string" || !action.UUID.startsWith(MULTI_ACTION_UUID_PREFIX)) return;
  const settings = action.Settings;
  if (!isPlainObject(settings) || !isPlainObject(settings.Routine)) return;
  const nestedActions = settings.Routine.Actions;
  if (!Array.isArray(nestedActions)) return;
  for (const nested of nestedActions) migrateActionNode(nested, counter);
}

function migrateProfileManifest(manifest, counter) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.Controllers)) return;
  for (const controller of manifest.Controllers) {
    if (!isPlainObject(controller) || !isPlainObject(controller.Actions)) continue;
    for (const action of Object.values(controller.Actions)) migrateActionNode(action, counter);
  }
}

async function readProfileArchive(path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw migrationError(`Input profile does not exist: ${path}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw migrationError(`Input profile must be a regular file: ${path}`);
  }
  if (metadata.size > MAX_ARCHIVE_BYTES) {
    throw migrationError(`Input profile exceeds the maximum size of ${MAX_ARCHIVE_BYTES} bytes.`);
  }
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.byteLength === 0) throw migrationError("Input profile is empty.");
  return bytes;
}

function assertProfileEntryNames(entries) {
  if (entries.length === 0) throw migrationError("Input archive has no entries.");
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw migrationError(`Input archive exceeds the maximum of ${MAX_ARCHIVE_ENTRIES} entries.`);
  }
  const roots = new Set();
  for (const entry of entries) {
    const [root] = entry.filename.split("/");
    if (root === undefined || !root.endsWith(PROFILE_ARCHIVE_DIRECTORY_EXTENSION)) {
      throw migrationError("Input archive is not an exported Stream Deck profile.");
    }
    roots.add(root);
  }
  if (roots.size !== 1) throw migrationError("Input archive contains more than one profile.");
  const [root] = [...roots];
  if (!entries.some((entry) => isProfileManifestEntry(entry.filename, root))) {
    throw migrationError("Input archive is missing its profile manifest.json.");
  }
  return root;
}

async function readEntries(bytes) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    return await reader.getEntries();
  } catch {
    throw migrationError("Input profile is not a readable Stream Deck profile archive.");
  } finally {
    await reader.close();
  }
}

async function loadEntries(bytes) {
  const entries = await readEntries(bytes);
  const root = assertProfileEntryNames(entries);
  const counter = { count: 0 };
  const loaded = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.directory) {
      loaded.push({ directory: true, filename: entry.filename });
      continue;
    }
    const data = await entry.getData(new Uint8ArrayWriter());
    totalBytes += data.byteLength;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw migrationError(`Input archive exceeds the maximum uncompressed size of ${MAX_UNCOMPRESSED_BYTES} bytes.`);
    }
    if (isProfileManifestEntry(entry.filename, root)) {
      let parsed;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data), preserveNumericTokens);
      } catch {
        throw migrationError(`Input profile contains invalid JSON: ${entry.filename}`);
      }
      migrateProfileManifest(parsed, counter);
      loaded.push({
        directory: false,
        filename: entry.filename,
        text: JSON.stringify(parsed),
      });
    } else {
      // Every other entry, including .json assets, is preserved byte-for-byte.
      loaded.push({ directory: false, filename: entry.filename, bytes: data });
    }
  }
  return { counter, entries: loaded };
}

async function repack(entries) {
  const archive = new ZipWriter(new BlobWriter("application/zip"));
  const options = {
    extendedTimestamp: false,
    lastModDate: FIXED_ARCHIVE_TIMESTAMP,
    level: ZIP_COMPRESSION_LEVEL,
  };
  for (const entry of entries) {
    if (entry.directory) {
      await archive.add(entry.filename, undefined, options);
    } else if (entry.text !== undefined) {
      await archive.add(entry.filename, new TextReader(entry.text), options);
    } else {
      await archive.add(entry.filename, new Uint8ArrayReader(entry.bytes), options);
    }
  }
  return new Uint8Array(await (await archive.close()).arrayBuffer());
}

async function assertOutputAvailable(output) {
  try {
    await lstat(output);
  } catch {
    return;
  }
  throw migrationError(`Output profile already exists and will not be overwritten: ${output}`);
}

export async function migrateProfileFile({ input, output }) {
  if (resolve(input) === resolve(output)) {
    throw migrationError("Input and output must not be the same path.");
  }
  assertProfileExtension(input, "Input path");
  assertProfileExtension(output, "Output path");
  const bytes = await readProfileArchive(input);
  const { counter, entries } = await loadEntries(bytes);
  await assertOutputAvailable(output);
  const migrated = await repack(entries);
  // "wx" keeps the never-overwrite guarantee even if the path appears mid-run.
  try {
    await writeFile(output, migrated, { flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw migrationError(`Output profile already exists and will not be overwritten: ${output}`);
    }
    throw error;
  }
  return { changedActions: counter.count, output };
}

async function main(argv) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const result = await migrateProfileFile(parsed);
  if (result.changedActions === 0) {
    console.log(`ai-deck: profile is already current (${CURRENT_PLUGIN_UUID}); no previous identity found.`);
  } else {
    console.log(`ai-deck: migrated ${result.changedActions} action reference(s) to ${CURRENT_PLUGIN_UUID}.`);
  }
  console.log(`ai-deck: wrote ${result.output}`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`ai-deck: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.exitCode === EXIT_USAGE) console.error(USAGE);
    process.exitCode = error instanceof Error && typeof error.exitCode === "number" ? error.exitCode : EXIT_FAILURE;
  }
}
