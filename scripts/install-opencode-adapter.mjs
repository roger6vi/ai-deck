import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED_ADAPTER = join("com.gentleman.ai-deck.sdPlugin", "bin", "opencode-plugin.js");
const TARGET_DIRECTORY = join(homedir(), ".config", "opencode", "plugins");
const TARGET_FILE = "ai-deck.js";

export function installOpenCodeAdapter(options = {}) {
  const source = options.source ?? BUNDLED_ADAPTER;
  const targetDirectory = options.targetDirectory ?? TARGET_DIRECTORY;
  if (!existsSync(source)) {
    throw new Error("Bundled OpenCode adapter not found. Run `npm run build` first.");
  }
  mkdirSync(targetDirectory, { recursive: true });
  const target = join(targetDirectory, TARGET_FILE);
  copyFileSync(source, target);
  if (readFileSync(target, "utf8") !== readFileSync(source, "utf8")) {
    throw new Error("Installed OpenCode adapter does not match the bundled bytes.");
  }
  return target;
}

const invokedDirectly = process.argv[1] !== undefined && (() => {
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const target = installOpenCodeAdapter();
  console.log(`ai-deck: OpenCode adapter installed at ${target}`);
}
