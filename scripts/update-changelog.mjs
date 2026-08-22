#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const [version, notesPath, changelogPath = "CHANGELOG.md"] = args.slice(checkOnly ? 1 : 0);
if (version === undefined || notesPath === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/update-changelog.mjs [--check] <x.y.z> <notes-file> [changelog-file]");
  process.exit(2);
}

const notes = (await readFile(notesPath, "utf8")).trim();
const lines = notes.split("\n");
const expectedHeading = `## v${version}`;
if (lines[0] !== expectedHeading) {
  throw new Error(`${notesPath} must start with exactly "${expectedHeading}".`);
}
if (notes.length === lines[0].length) throw new Error(`${notesPath} must contain release details.`);

let changelog = "# Changelog\n";
try {
  changelog = await readFile(changelogPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!changelog.startsWith("# Changelog\n")) throw new Error(`${changelogPath} must start with "# Changelog".`);

const changelogLines = changelog.trimEnd().split("\n");
const matchingHeadings = changelogLines.reduce((matches, line, index) => line === expectedHeading ? [...matches, index] : matches, []);
if (matchingHeadings.length > 1) throw new Error(`${changelogPath} contains duplicate ${expectedHeading} sections.`);
if (checkOnly) {
  console.log(`${notesPath} is valid for v${version}; ${changelogPath} has no duplicate section.`);
  process.exit(0);
}

if (matchingHeadings.length === 1) {
  const start = matchingHeadings[0];
  let end = changelogLines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end === -1) end = changelogLines.length;
  changelogLines.splice(start, end - start);
}

const remainder = changelogLines.slice(1).join("\n").trim();
const next = `# Changelog\n\n${notes}${remainder === "" ? "" : `\n\n${remainder}`}\n`;
await writeFile(changelogPath, next);
console.log(`${changelogPath} updated for v${version}.`);
