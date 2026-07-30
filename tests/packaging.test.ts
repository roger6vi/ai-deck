import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { buildPlugin } from "../scripts/build-plugin.mjs";
import { assertPackageContents } from "../scripts/check-package.mjs";
import { packPlugin, runStreamDeckPack } from "../scripts/pack-plugin.mjs";
import { preparePackageStage } from "../scripts/prepare-package-stage.mjs";
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
const SMOKE_STARTUP_TIMEOUT_MILLISECONDS = 2_000;
const SMOKE_TERMINATION_TIMEOUT_MILLISECONDS = 50;

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
  it("excludes runtime secrets from the isolated package stage without touching the source plugin", async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, "source.sdPlugin");
    const stage = join(directory, "stage.sdPlugin");
    const sentinel = "PACKAGE_RUNTIME_TOKEN_SENTINEL";
    await mkdir(join(source, "runtime"), { recursive: true });
    await writeFile(join(source, "manifest.json"), "{}", "utf8");
    await writeFile(join(source, "runtime", "endpoint.json"), sentinel, "utf8");

    await preparePackageStage(source, stage);

    await expect(readFile(join(stage, "manifest.json"), "utf8")).resolves.toBe("{}");
    await expect(readFile(join(stage, "runtime", "endpoint.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(source, "runtime", "endpoint.json"), "utf8")).resolves.toBe(sentinel);
  });

  it("keeps a validated safe archive while removing successful transaction staging", async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, "source.sdPlugin"); const stage = join(directory, "stage.sdPlugin"); const archive = join(directory, "dist", "plugin.streamDeckPlugin");
    await mkdir(source, { recursive: true }); await mkdir(join(directory, "dist"), { recursive: true }); await writeFile(join(source, "manifest.json"), "{}", "utf8");
    await packPlugin({ source, stage, archive, pack: async () => writeFile(archive, "safe-archive", "utf8"), validate: async () => expect(readFile(archive, "utf8")).resolves.toBe("safe-archive") });
    await expect(readFile(archive, "utf8")).resolves.toBe("safe-archive");
    await expect(readFile(join(stage, "manifest.json"), "utf8")).rejects.toThrow();
  });

  it("surfaces cleanup failure with the primary validation failure", async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, "source.sdPlugin"); const stage = join(directory, "stage.sdPlugin"); const archive = join(directory, "dist", "plugin.streamDeckPlugin");
    const sentinel = "PACKAGE_RUNTIME_TOKEN_SENTINEL"; let archiveRemovals = 0; let failure: AggregateError | undefined;
    await mkdir(join(source, "runtime"), { recursive: true }); await mkdir(join(directory, "dist"), { recursive: true }); await writeFile(join(source, "manifest.json"), "{}", "utf8"); await writeFile(join(source, "runtime", "endpoint.json"), sentinel, "utf8");
    try { await packPlugin({ source, stage, archive, pack: async () => writeFile(archive, sentinel, "utf8"), validate: async () => { throw new Error("validation failed"); }, remove: async (path, options) => { if (path === archive && ++archiveRemovals > 1) throw new Error("cleanup failed"); await rm(path, options); } }); } catch (error) { if (error instanceof AggregateError) failure = error; }
    expect(failure?.cause).toHaveProperty("message", "validation failed");
    expect(failure?.errors.map((error) => (error as Error).message)).toEqual(["validation failed", "cleanup failed"]);
    expect(String(failure)).not.toContain(sentinel);
  });

  it("removes a newly unsafe archive when downstream package validation fails", async () => {
    const directory = await temporaryDirectory();
    const source = join(directory, "source.sdPlugin");
    const stage = join(directory, "stage.sdPlugin");
    const archive = join(directory, "dist", "plugin.streamDeckPlugin");
    const sentinel = "PACKAGE_RUNTIME_TOKEN_SENTINEL";
    await mkdir(join(source, "runtime"), { recursive: true });
    await mkdir(join(directory, "dist"), { recursive: true });
    await writeFile(join(source, "manifest.json"), "{}", "utf8");
    await writeFile(join(source, "runtime", "endpoint.json"), sentinel, "utf8");
    await writeFile(archive, "known-good-archive", "utf8");

    await expect(packPlugin({ source, stage, archive, pack: async (staged) => {
      await expect(readFile(join(staged, "runtime", "endpoint.json"), "utf8")).rejects.toThrow();
      await writeFile(archive, sentinel, "utf8");
    }, validate: async () => {
      await expect(readFile(archive, "utf8")).resolves.toBe(sentinel);
      throw new Error("downstream validation failed");
    } })).rejects.toThrow("downstream validation failed");

    await expect(readFile(archive, "utf8")).rejects.toThrow();
    await expect(readFile(join(stage, "manifest.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(source, "runtime", "endpoint.json"), "utf8")).resolves.toBe(sentinel);
  });

  it("contains child spawn failure within package cleanup", async () => {
    const directory = await temporaryDirectory(); const source = join(directory, "source.sdPlugin"); const stage = join(directory, "stage.sdPlugin"); const archive = join(directory, "dist", "plugin.streamDeckPlugin"); const sentinel = "PACKAGE_RUNTIME_TOKEN_SENTINEL";
    await mkdir(join(source, "runtime"), { recursive: true }); await mkdir(join(directory, "dist"), { recursive: true }); await writeFile(join(source, "manifest.json"), "{}", "utf8"); await writeFile(join(source, "runtime", "endpoint.json"), sentinel, "utf8");
    await expect(packPlugin({ source, stage, archive, pack: async (staged) => { await writeFile(archive, sentinel, "utf8"); await runStreamDeckPack(staged, "ai-deck-missing-streamdeck"); } })).rejects.toThrow();
    await expect(readFile(archive, "utf8")).rejects.toThrow(); await expect(readFile(join(stage, "manifest.json"), "utf8")).rejects.toThrow(); await expect(readFile(join(source, "runtime", "endpoint.json"), "utf8")).resolves.toBe(sentinel);
  });

  it("allows only the runnable package contract and rejects private paths", () => {
    expect(() => assertPackageContents(PACKAGE_FILES)).not.toThrow();
    for (const privatePath of ["bin.previous/plugin.js", "bin.next/plugin.js", "logs/plugin.log", "runtime/state", "token", "state-snapshot.json", "src/plugin.ts", "tests/test.ts", "node_modules/x"]) {
      expect(() => assertPackageContents([...PACKAGE_FILES, privatePath])).toThrow("allowlist");
    }
  });

  it.each(["bin/plugin.js", "manifest.json"])("rejects duplicate archive entry %s", (duplicate) => {
    expect(() => assertPackageContents([...PACKAGE_FILES, duplicate])).toThrow("allowlist");
  });

  it("bounds the entrypoint smoke and requires the generic launch failure", async () => {
    const directory = await temporaryDirectory();
    const launchError = join(directory, "launch-error.mjs");
    const ignoresTermination = join(directory, "ignores-termination.mjs");
    const neverReady = join(directory, "never-ready.mjs");
    await writeFile(launchError, 'console.error("AI Deck launch parameter error."); process.exitCode = 1;');
    await writeFile(ignoresTermination, "setTimeout(() => { process.on('SIGTERM', () => {}); process.stderr.write('READY\\n'); }, 100); setInterval(() => {}, 1_000);");
    await writeFile(neverReady, "setInterval(() => {}, 1_000);");

    await expect(runRuntimeSmoke(launchError, SMOKE_STARTUP_TIMEOUT_MILLISECONDS)).resolves.toBe("AI Deck launch parameter error.");
    await expect(runRuntimeSmoke(ignoresTermination, SMOKE_TERMINATION_TIMEOUT_MILLISECONDS, "READY", 200)).rejects.toThrow(/SIGKILL/);
    await expect(runRuntimeSmoke(neverReady, SMOKE_TERMINATION_TIMEOUT_MILLISECONDS, "READY", 100)).rejects.toThrow("after 1200ms");
  }, 10_000);

  it("uses the official CLI's documented non-mutating help syntax", async () => {
    const cli = "node_modules/@elgato/cli/bin/streamdeck.mjs";
    for (const [command, expected] of Object.entries(CLI_HELP)) {
      const { stdout } = await executeFile(process.execPath, [cli, command, "--help"]);
      expect(stdout).toContain(expected);
    }
  }, 10_000);
});
