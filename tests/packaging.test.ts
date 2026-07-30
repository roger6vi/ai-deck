import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { buildPlugin } from "../scripts/build-plugin.mjs";
import { assertPackageContents } from "../scripts/check-package.mjs";
import { runRuntimeSmoke } from "../scripts/runtime-smoke.mjs";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];
const PACKAGE_FILES = [
  "manifest.json",
  "bin/package.json",
  "bin/plugin.js",
  "assets/action.png",
  "assets/action@2x.png",
  "assets/key.png",
  "assets/key@2x.png",
  "assets/plugin.png",
  "assets/plugin@2x.png",
  "assets/category-icon.png",
  "assets/category-icon@2x.png",
  "Profiles/Local Agent Status.streamDeckProfile",
] as const;
const CLI_HELP = {
  link: "Links the plugin",
  unlink: "--delete",
  restart: "Starts the plugin",
  pack: "--dry-run",
} as const;

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-deck-packaging-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))));

describe("interruption-safe plugin build", () => {
  it("preserves the runnable bin when Rollup fails", async () => {
    const directory = await temporaryDirectory();
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "plugin.js"), "known-good");

    await expect(buildPlugin(directory, async () => { throw new Error("rollup failed"); })).rejects.toThrow("rollup failed");
    await expect(readFile(join(bin, "plugin.js"), "utf8")).resolves.toBe("known-good");
  });

  it("recovers an interrupted backup and swaps only a successful next build", async () => {
    const directory = await temporaryDirectory();
    const bin = join(directory, "bin");
    await mkdir(`${bin}.previous`);
    await writeFile(join(`${bin}.previous`, "plugin.js"), "interrupted");

    await buildPlugin(directory, async (next) => {
      await expect(readFile(join(bin, "plugin.js"), "utf8")).resolves.toBe("interrupted");
      await writeFile(join(next, "plugin.js"), "current");
    });
    await expect(readFile(join(bin, "plugin.js"), "utf8")).resolves.toBe("current");
    await expect(readFile(`${bin}.previous/plugin.js`, "utf8")).rejects.toThrow();
  });

  it("restores the prior bin when the next swap fails", async () => {
    const directory = await temporaryDirectory();
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "plugin.js"), "known-good");

    await expect(buildPlugin(directory, async (next) => rm(next, { force: true, recursive: true }))).rejects.toThrow();
    await expect(readFile(join(bin, "plugin.js"), "utf8")).resolves.toBe("known-good");
  });
});

describe("package and runtime smoke boundaries", () => {
  it("allows only the runnable package contract and rejects private paths", () => {
    expect(() => assertPackageContents(PACKAGE_FILES)).not.toThrow();
    for (const privatePath of ["bin.previous/plugin.js", "bin.next/plugin.js", "logs/plugin.log", "runtime/state", "token", "state-snapshot.json", "src/plugin.ts", "tests/test.ts", "node_modules/x"]) {
      expect(() => assertPackageContents([...PACKAGE_FILES, privatePath])).toThrow("allowlist");
    }
  });

  it.each(["bin/plugin.js", "manifest.json"])("rejects duplicate archive entry %s", (duplicate) => {
    expect(() => assertPackageContents([...PACKAGE_FILES, duplicate])).toThrow("allowlist");
  });

  it("bounds the entrypoint smoke and requires a precise launch failure", async () => {
    const directory = await temporaryDirectory();
    const launchError = join(directory, "launch-error.mjs");
    const ignoresTermination = join(directory, "ignores-termination.mjs");
    await writeFile(launchError, 'console.error("AI Deck launch parameter error: Unable to establish a connection with Stream Deck, missing command line arguments: -port"); process.exitCode = 1;');
    await writeFile(ignoresTermination, "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(9), 300);");

    await expect(runRuntimeSmoke(launchError, 500)).resolves.toContain("-port");
    const startedAt = Date.now();
    await expect(runRuntimeSmoke(ignoresTermination, 30)).rejects.toThrow("SIGKILL");
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("uses the official CLI's documented non-mutating help syntax", async () => {
    const cli = "node_modules/@elgato/cli/bin/streamdeck.mjs";
    for (const [command, expected] of Object.entries(CLI_HELP)) {
      const { stdout } = await executeFile(process.execPath, [cli, command, "--help"]);
      expect(stdout).toContain(expected);
    }
  });
});
