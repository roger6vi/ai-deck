import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = "com.gentleman.ai-deck.sdPlugin";

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function runRollup(outputDirectory) {
  const child = spawn("npm", ["run", "build:rollup"], {
    env: { ...process.env, AI_DECK_OUTPUT_DIRECTORY: outputDirectory },
    stdio: "inherit",
  });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`Rollup build failed with exit code ${code}.`);
}

export async function buildPlugin(pluginDirectory = PLUGIN_DIRECTORY, build = runRollup) {
  const bin = join(pluginDirectory, "bin");
  const next = `${bin}.next`;
  const previous = `${bin}.previous`;

  if (!(await exists(bin)) && (await exists(previous))) await rename(previous, bin);
  await rm(next, { force: true, recursive: true });
  await mkdir(next, { recursive: true });
  try {
    await build(next);
  } catch (error) {
    await rm(next, { force: true, recursive: true });
    throw error;
  }

  const hasCurrentBuild = await exists(bin);
  await rm(previous, { force: true, recursive: true });
  if (hasCurrentBuild) await rename(bin, previous);
  try {
    await rename(next, bin);
    await rm(previous, { force: true, recursive: true });
  } catch (error) {
    await rm(next, { force: true, recursive: true });
    if (hasCurrentBuild) await rename(previous, bin);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPlugin();
