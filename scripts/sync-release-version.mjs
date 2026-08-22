#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VERSION_TARGETS = [
  { path: "package.json", keys: ["version"] },
  { path: "package-lock.json", keys: ["version"] },
  { path: "package-lock.json", keys: ["packages", "", "version"] },
  { path: "io.github.roger6vi.ai-deck.sdPlugin/manifest.json", keys: ["Version"], format: (version) => `${version}.0` },
  { path: "claude-code-plugin/.claude-plugin/plugin.json", keys: ["version"] },
  { path: "codex-plugin/.codex-plugin/plugin.json", keys: ["version"] },
  { path: ".claude-plugin/marketplace.json", keys: ["plugins", 0, "version"] },
];

function usage() {
  console.error("Usage: node scripts/sync-release-version.mjs [--check] <x.y.z>");
  process.exit(2);
}

function valueAt(document, keys, path) {
  let value = document;
  for (const key of keys) {
    if (value === null || typeof value !== "object" || !(key in value)) {
      throw new Error(`Missing version field ${keys.join(".")} in ${path}.`);
    }
    value = value[key];
  }
  if (typeof value !== "string") throw new Error(`Version field ${keys.join(".")} in ${path} must be a string.`);
  return value;
}

function setValueAt(document, keys, value) {
  let target = document;
  for (const key of keys.slice(0, -1)) target = target[key];
  target[keys.at(-1)] = value;
}

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const version = args[checkOnly ? 1 : 0];
if (version === undefined || args.length !== (checkOnly ? 2 : 1) || !VERSION_PATTERN.test(version)) usage();

const documents = new Map();
for (const target of VERSION_TARGETS) {
  if (!documents.has(target.path)) {
    documents.set(target.path, JSON.parse(await readFile(target.path, "utf8")));
  }
  const document = documents.get(target.path);
  const expected = target.format?.(version) ?? version;
  const current = valueAt(document, target.keys, target.path);
  if (checkOnly && current !== expected) {
    throw new Error(`${target.path} has ${current} at ${target.keys.join(".")}; expected ${expected}.`);
  }
  if (!checkOnly) setValueAt(document, target.keys, expected);
}

if (!checkOnly) {
  await Promise.all([...documents].map(([path, document]) => writeFile(path, `${JSON.stringify(document, null, 2)}\n`)));
}

console.log(`Release version ${version} ${checkOnly ? "is synchronized" : "synchronized"} across ${VERSION_TARGETS.length} fields.`);
