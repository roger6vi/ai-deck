import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

const PACKAGE_PATH = "dist/com.gentleman.ai-deck.streamDeckPlugin";
const PACKAGE_ROOT = "com.gentleman.ai-deck.sdPlugin/";
const EXPECTED_FILES = [
  "manifest.json",
  "bin/package.json",
  "bin/plugin.js",
  "bin/adapter-emit.js",
  "bin/opencode-plugin.js",
  "ui/session-slot.html",
  "assets/action.png",
  "assets/action@2x.png",
  "assets/key.png",
  "assets/key@2x.png",
  "assets/plugin.png",
  "assets/plugin@2x.png",
  "assets/category-icon.png",
  "assets/category-icon@2x.png",
  "Profiles/Local Agent Status.streamDeckProfile",
].sort();

export function assertPackageContents(names) {
  const sorted = [...names].sort();
  if (
    names.length !== EXPECTED_FILES.length ||
    new Set(names).size !== EXPECTED_FILES.length ||
    sorted.some((name, index) => name !== EXPECTED_FILES[index])
  ) {
    throw new Error("Package contents must match the exact allowlist.");
  }
}

export async function assertPackageFile(packagePath = PACKAGE_PATH) {
  const reader = new ZipReader(new Uint8ArrayReader(await readFile(packagePath)));
  try {
    const entries = await reader.getEntries({ strictness: "strict" });
    if (entries.some((entry) => entry.directory)) throw new Error("Package directories are not allowed.");
    const names = entries.map((entry) => entry.filename);
    if (names.some((name) => !name.startsWith(PACKAGE_ROOT))) {
      throw new Error("Package files must be rooted in the plugin directory.");
    }
    assertPackageContents(names.map((name) => name.slice(PACKAGE_ROOT.length)));
  } finally {
    await reader.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await assertPackageFile();
