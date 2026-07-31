import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import { buildProfile } from "./build-profile.mjs";
import { PROFILE_FILE } from "./profile-contract.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSET_DIRECTORY = "com.gentleman.ai-deck.sdPlugin/assets";
const PROFILE_DIRECTORY = "com.gentleman.ai-deck.sdPlugin/Profiles";
const ASSET_FILES = Object.freeze([
  "plugin.png",
  "plugin@2x.png",
  "action.png",
  "action@2x.png",
  "key.png",
  "key@2x.png",
  "category-icon.png",
  "category-icon@2x.png",
]);
const BUILD_ASSETS_SCRIPT = fileURLToPath(new URL("./build-assets.mjs", import.meta.url));
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CRC32_INITIAL_VALUE = 0xffffffff;
const PNG_CRC32_POLYNOMIAL = 0xedb88320;

export const GENERATED_OUTPUTS = Object.freeze([
  ...ASSET_FILES.map((file) => `${ASSET_DIRECTORY}/${file}`),
  PROFILE_FILE,
]);

export function classifyGeneratedStatus(status) {
  const driftedOutputs = status.filter((line) => {
    if (line.startsWith("??")) return true;
    const [index, worktree] = line;

    return index === "D" || index === "R" || worktree !== " ";
  });

  return { isAcceptable: driftedOutputs.length === 0, driftedOutputs };
}

export function assertGeneratedState(status) {
  const result = classifyGeneratedStatus(status);
  if (!result.isAcceptable) {
    throw new Error(`Generated output has untracked, removed, renamed, or unstaged drift:\n${result.driftedOutputs.join("\n")}`);
  }
}

function assertExactFiles(actual, expected, directory) {
  const missing = expected.filter((file) => !actual.includes(file));
  const unexpected = actual.filter((file) => !expected.includes(file));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Generated outputs in ${directory} are missing (${missing.join(", ") || "none"}) or unexpected (${unexpected.join(", ") || "none"}).`);
  }
}

async function readRegularFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nonRegular = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name);
    if (nonRegular.length > 0) {
      throw new Error(`Generated outputs in ${directory} must contain regular files only: ${nonRegular.join(", ")}.`);
    }
    return entries
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function crc32(data) {
  let value = PNG_CRC32_INITIAL_VALUE;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const hasLeastSignificantBit = (value & 1) === 1;
      value >>>= 1;
      if (hasLeastSignificantBit) value ^= PNG_CRC32_POLYNOMIAL;
    }
  }
  return (value ^ PNG_CRC32_INITIAL_VALUE) >>> 0;
}

function expectedScanlineLength(png) {
  const headerOffset = PNG_SIGNATURE.length + 8;
  if (png.length < headerOffset + 13 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) || png.readUInt32BE(8) !== 13 || png.subarray(12, headerOffset).toString("ascii") !== "IHDR") throw new Error("Expected PNG header is invalid.");
  const header = png.subarray(headerOffset, headerOffset + 13);
  if (header[8] !== 8 || header[9] !== 6 || header[10] !== 0 || header[11] !== 0 || header[12] !== 0) throw new Error("Expected PNG format is invalid.");
  const length = (header.readUInt32BE(0) * 4 + 1) * header.readUInt32BE(4);
  if (!Number.isSafeInteger(length)) throw new Error("Expected PNG scanline length is invalid.");
  return length;
}

function canonicalPng(png, maxOutputLength) {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("PNG signature is invalid.");
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("PNG chunk is truncated.");
    const length = png.readUInt32BE(offset);
    const dataStart = offset + 8;
    const end = dataStart + length + 4;
    if (end > png.length) throw new Error("PNG chunk data is truncated.");
    const type = png.subarray(offset + 4, dataStart).toString("ascii");
    const data = png.subarray(dataStart, dataStart + length);
    if (crc32(png.subarray(offset + 4, dataStart + length)) !== png.readUInt32BE(dataStart + length)) {
      throw new Error("PNG chunk checksum is invalid.");
    }
    chunks.push({ type, data });
    offset = end;
  }

  const [header, imageData, end] = chunks;
  if (
    chunks.length !== 3 ||
    header?.type !== "IHDR" ||
    header.data.length !== 13 ||
    imageData?.type !== "IDAT" ||
    end?.type !== "IEND" ||
    end.data.length !== 0
  ) {
    throw new Error("PNG chunks do not match the generated asset contract.");
  }

  const result = inflateSync(imageData.data, { info: true, maxOutputLength });
  if (result.engine.bytesWritten !== imageData.data.length) throw new Error("PNG IDAT has trailing data.");
  return { header: header.data, scanlines: result.buffer };
}

function generatedOutputMatches(actual, expected, output) {
  if (!output.endsWith(".png")) return actual.equals(expected);
  try {
    const expectedPng = canonicalPng(expected, expectedScanlineLength(expected));
    const actualPng = canonicalPng(actual, expectedPng.scanlines.length);
    return actualPng.header.equals(expectedPng.header) && actualPng.scanlines.equals(expectedPng.scanlines);
  } catch {
    return false;
  }
}

async function buildExpectedOutputs(directory) {
  const assets = join(directory, ASSET_DIRECTORY);
  const profile = join(directory, PROFILE_FILE);
  await Promise.all([
    promisify(execFile)(process.execPath, [BUILD_ASSETS_SCRIPT, "--output-directory", assets]),
    buildProfile(profile),
  ]);
}

export async function assertGeneratedArtifacts(projectRoot = PROJECT_ROOT) {
  const assetDirectory = resolve(projectRoot, ASSET_DIRECTORY);
  const profileDirectory = resolve(projectRoot, PROFILE_DIRECTORY);
  assertExactFiles(await readRegularFiles(assetDirectory), [...ASSET_FILES].sort(), ASSET_DIRECTORY);
  assertExactFiles(await readRegularFiles(profileDirectory), [PROFILE_FILE.split("/").at(-1)], PROFILE_DIRECTORY);

  const expectedDirectory = await mkdtemp(join(tmpdir(), "ai-deck-generated-"));
  try {
    await buildExpectedOutputs(expectedDirectory);
    for (const output of GENERATED_OUTPUTS) {
      const [actual, expected] = await Promise.all([
        readFile(resolve(projectRoot, output)),
        readFile(resolve(expectedDirectory, output)),
      ]);
      if (!generatedOutputMatches(actual, expected, output)) {
        throw new Error(`Generated output ${output} does not match deterministic generation.`);
      }
    }
  } finally {
    await rm(expectedDirectory, { force: true, recursive: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { stdout } = await promisify(execFile)("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...GENERATED_OUTPUTS,
  ]);
  assertGeneratedState(stdout.trim() === "" ? [] : stdout.trim().split("\n"));
  await assertGeneratedArtifacts();
}
