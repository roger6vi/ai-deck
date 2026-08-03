import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CODEX_HOOK_LIFECYCLES } from "../src/adapters/codex-session";

const PLUGIN_DIRECTORY = "codex-plugin";
const HOOK_BUNDLE = join(PLUGIN_DIRECTORY, "hooks", "codex-hook.mjs");
const ABSOLUTE_PATH_PATTERN = /(^|[\s"'])[/~]|\/Users\//;

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

const marketplace = readJson(join(".agents", "plugins", "marketplace.json"));
const manifest = readJson(join(PLUGIN_DIRECTORY, ".codex-plugin", "plugin.json"));
const hooks = readJson(join(PLUGIN_DIRECTORY, "hooks", "hooks.json"));

function hookEntries(): { readonly event: string; readonly command: string }[] {
  return Object.entries(hooks.hooks as Record<string, any[]>)
    .flatMap(([event, entries]) => entries.flatMap((entry) => (entry.hooks ?? []).map((hook: any) => ({ event, command: hook.command as string }))));
}

describe("Codex plugin packaging", () => {
  it("is published by the repository's Codex marketplace under its manifest name", () => {
    const published = (marketplace.plugins ?? []).find((plugin: any) => plugin.source?.path === `./${PLUGIN_DIRECTORY}`);
    expect(published?.name).toBe(manifest.name);
  });

  it("covers the turn, the permission prompt and the end of the session", () => {
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PermissionRequest", "SessionEnd", "Stop", "UserPromptSubmit"]);
  });

  it("declares only lifecycles the hook will accept", () => {
    for (const { command } of hookEntries()) {
      const lifecycle = /--lifecycle\s+(\S+)/.exec(command)?.[1];
      expect(CODEX_HOOK_LIFECYCLES).toContain(lifecycle);
    }
  });

  it("blocks the agent on a permission prompt, which is the moment worth a blue key", () => {
    const permission = hookEntries().filter((entry) => entry.event === "PermissionRequest");
    expect(permission).toHaveLength(1);
    expect(permission[0]?.command).toContain("--lifecycle completed");
  });

  it("keeps the SessionEnd timeout inside the cap Codex clamps it to", () => {
    const sessionEnd = (hooks.hooks.SessionEnd ?? []).flatMap((entry: any) => entry.hooks ?? []);
    expect(sessionEnd).toHaveLength(1);
    expect(sessionEnd[0]?.timeout).toBeLessThanOrEqual(3);
  });

  it("locates the hook through the plugin root so it stays portable across machines", () => {
    for (const { command } of hookEntries()) {
      expect(command).toContain("${PLUGIN_ROOT}/hooks/codex-hook.mjs");
      expect(command).not.toMatch(ABSOLUTE_PATH_PATTERN);
      expect(command.trimEnd()).toMatch(/\|\|\s*true$/);
    }
  });

  it("ships the bundled hook as a committed, self-contained ES module", () => {
    const bundle = readFileSync(HOOK_BUNDLE, "utf8");
    expect(bundle).toContain("runCodexHook");
    expect(bundle).not.toMatch(/require\(/);
    expect(bundle).not.toContain("/Users/");
  });
});
