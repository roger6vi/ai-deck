import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readReadme(): Promise<string> {
  return readFile(resolve(REPOSITORY_ROOT, "README.md"), { encoding: "utf8" });
}

describe("README setup and rollback documentation", () => {
  it("documents Node 24 and the streamdeck CLI as prerequisites", async () => {
    const readme = await readReadme();
    expect(readme).toMatch(/Node\.js\s+\*\*24\.x\*\*/);
    expect(readme).toMatch(/streamdeck.*CLI/i);
  });

  it("documents the exact install command sequence", async () => {
    const readme = await readReadme();
    for (const command of ["npm install", "npm run build", "npm run pack", "npm run restart:plugin"]) {
      expect(readme).toContain(command);
    }
  });

  it("documents the uninstall command and the runtime/dist cleanup paths", async () => {
    const readme = await readReadme();
    expect(readme).toContain("npm run uninstall:plugin");
    expect(readme).toContain("com.gentleman.ai-deck.sdPlugin/bin");
    expect(readme).toContain("com.gentleman.ai-deck.sdPlugin/runtime");
    expect(readme).toContain("dist");
  });

  it("documents rollback via restoring the previously packaged plugin directory", async () => {
    const readme = await readReadme();
    expect(readme).toMatch(/roll ?back/i);
    expect(readme).toContain("com.gentleman.ai-deck.sdPlugin");
  });

  it("names the privacy boundary and points to the event contract module", async () => {
    const readme = await readReadme();
    expect(readme).toContain("src/core/events.ts");
    expect(readme).toMatch(/allowlist/i);
    expect(readme).toMatch(/parseLocalAgentStatusEvent/);
  });

  it("names the verification gate", async () => {
    const readme = await readReadme();
    expect(readme).toContain("npm run verify");
  });

  it("documents the adapter emit CLI and its exit code mapping", async () => {
    const readme = await readReadme();
    expect(readme).toContain("src/cli/adapter-emit.ts");
    expect(readme).toContain("AI_DECK_PLUGIN_ROOT");
    for (const outcome of ["emitted", "rejected", "unavailable", "timed-out", "local error"]) {
      expect(readme).toContain(outcome);
    }
  });
});
