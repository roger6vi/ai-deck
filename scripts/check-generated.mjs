import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
]);
const BUILD_ASSETS_SCRIPT = fileURLToPath(new URL("./build-assets.mjs", import.meta.url));

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
      if (!actual.equals(expected)) {
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
