import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLAUDE_HOOK_EVENTS } from "../src/adapters/claude-session";

const PLUGIN_DIRECTORY = "claude-code-plugin";
const HOOK_BUNDLE = join(PLUGIN_DIRECTORY, "hooks", "claude-hook.mjs");
const ABSOLUTE_PATH_PATTERN = /(^|[\s"'])[/~]|\/Users\//;

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

const marketplace = readJson(join(".claude-plugin", "marketplace.json"));
const manifest = readJson(join(PLUGIN_DIRECTORY, ".claude-plugin", "plugin.json"));
const hooks = readJson(join(PLUGIN_DIRECTORY, "hooks", "hooks.json"));

function hookCommands(): string[] {
  return Object.values(hooks.hooks as Record<string, any[]>)
    .flatMap((entries) => entries.flatMap((entry) => (entry.hooks ?? []).map((hook: any) => hook.command)));
}

describe("Claude Code plugin packaging", () => {
  it("is published by the repository marketplace under its manifest name", () => {
    const published = (marketplace.plugins ?? []).find((plugin: any) => plugin.source === `./${PLUGIN_DIRECTORY}`);
    expect(published?.name).toBe(manifest.name);
  });

  it("registers exactly the hook events the adapter maps", () => {
    expect(Object.keys(hooks.hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort());
  });

  it("locates the hook through the plugin root so it stays portable across machines", () => {
    const commands = hookCommands();
    expect(commands).toHaveLength(CLAUDE_HOOK_EVENTS.length);
    for (const command of commands) {
      expect(command).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/claude-hook.mjs");
      expect(command).not.toMatch(ABSOLUTE_PATH_PATTERN);
    }
  });

  it("swallows a failing hook so a missing Node or Stream Deck cannot discard a prompt", () => {
    for (const command of hookCommands()) {
      expect(command.trimEnd()).toMatch(/\|\|\s*true$/);
    }
  });

  it("ships the bundled hook as a committed, self-contained ES module", () => {
    const bundle = readFileSync(HOOK_BUNDLE, "utf8");
    expect(bundle).toContain("runClaudeHook");
    expect(bundle).not.toMatch(/require\(/);
    expect(bundle).not.toContain("/Users/");
  });
});
