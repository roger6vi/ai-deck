import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { preparePackageStage } from "./prepare-package-stage.mjs";
import { assertPackageFile } from "./check-package.mjs";

const PLUGIN_DIRECTORY = "com.gentleman.ai-deck.sdPlugin";
const STAGE_DIRECTORY = ".package-stage/com.gentleman.ai-deck.sdPlugin";
const ARCHIVE_PATH = "dist/com.gentleman.ai-deck.streamDeckPlugin";

export function runStreamDeckPack(stage, command = "streamdeck") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["pack", stage, "--output", "dist", "--force", "--no-update-check"], { stdio: "inherit" });
    const settle = (error) => {
      child.off("error", onError); child.off("close", onClose);
      if (error) reject(error); else resolve();
    };
    const onError = (error) => settle(error);
    const onClose = (code) => settle(code === 0 ? undefined : new Error(`Stream Deck package failed with exit code ${code}.`));
    child.once("error", onError); child.once("close", onClose);
  });
}

export async function packPlugin(options = {}) {
  const source = options.source ?? PLUGIN_DIRECTORY;
  const stage = options.stage ?? STAGE_DIRECTORY;
  const archive = options.archive ?? ARCHIVE_PATH;
  const pack = options.pack ?? runStreamDeckPack;
  const validate = options.validate ?? (() => assertPackageFile(archive));
  const remove = options.remove ?? rm;
  let completed = false;
  let primaryFailure;
  try {
    await remove(archive, { force: true });
    await preparePackageStage(source, stage);
    await pack(stage);
    await validate();
    completed = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanup = [Promise.resolve().then(() => remove(stage, { force: true, recursive: true }))];
    if (!completed) cleanup.push(Promise.resolve().then(() => remove(archive, { force: true })));
    const cleanupFailures = (await Promise.allSettled(cleanup)).filter((result) => result.status === "rejected").map((result) => result.reason);
    if (cleanupFailures.length > 0) throw new AggregateError(primaryFailure === undefined ? cleanupFailures : [primaryFailure, ...cleanupFailures], "Package transaction cleanup failed.", { cause: primaryFailure });
  }
  if (primaryFailure !== undefined) throw primaryFailure;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await packPlugin();
