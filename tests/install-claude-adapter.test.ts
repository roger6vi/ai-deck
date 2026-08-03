import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CLAUDE_HOOK_EVENTS, installClaudeAdapter } from "../scripts/install-claude-adapter.mjs";

const temporary: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "ai-deck-claude-install-"));
  temporary.push(directory);
  return directory;
}

function builtPluginRoot(): string {
  const pluginRoot = join(scratch(), "com.gentleman.ai-deck.sdPlugin");
  mkdirSync(join(pluginRoot, "bin"), { recursive: true });
  writeFileSync(join(pluginRoot, "bin", "claude-hook.js"), "// bundled hook\n");
  return pluginRoot;
}

function readSettings(settingsPath: string): Record<string, any> {
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

function commandsFor(settings: Record<string, any>, event: string): string[] {
  return (settings.hooks?.[event] ?? []).flatMap((entry: any) => (entry.hooks ?? []).map((hook: any) => hook.command));
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() ?? "", { recursive: true, force: true });
});

describe("installClaudeAdapter", () => {
  it("fails loudly when the bundled hook is missing", () => {
    expect(() => installClaudeAdapter({ pluginRoot: join(scratch(), "missing"), settingsPath: join(scratch(), "settings.json") }))
      .toThrow("npm run build");
  });

  it("registers the hook for every lifecycle event in a fresh settings file", () => {
    const pluginRoot = builtPluginRoot();
    const settingsPath = join(scratch(), "settings.json");

    installClaudeAdapter({ pluginRoot, settingsPath });

    const settings = readSettings(settingsPath);
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(commandsFor(settings, event)).toEqual([expect.stringContaining(join(pluginRoot, "bin", "claude-hook.js"))]);
    }
  });

  it("keeps unrelated settings and unrelated hooks untouched", () => {
    const pluginRoot = builtPluginRoot();
    const settingsPath = join(scratch(), "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "codegraph prompt-hook" }] }] },
      model: "opus",
    }));

    installClaudeAdapter({ pluginRoot, settingsPath });

    const settings = readSettings(settingsPath);
    expect(settings.model).toBe("opus");
    expect(commandsFor(settings, "UserPromptSubmit")).toEqual([
      "codegraph prompt-hook",
      expect.stringContaining("claude-hook.js"),
    ]);
  });

  it("replaces its own previous registration instead of duplicating it", () => {
    const pluginRoot = builtPluginRoot();
    const settingsPath = join(scratch(), "settings.json");

    installClaudeAdapter({ pluginRoot, settingsPath });
    installClaudeAdapter({ pluginRoot, settingsPath });
    const relocated = builtPluginRoot();
    installClaudeAdapter({ pluginRoot: relocated, settingsPath });

    expect(commandsFor(readSettings(settingsPath), "Stop")).toEqual([
      expect.stringContaining(join(relocated, "bin", "claude-hook.js")),
    ]);
  });

  it("refuses to overwrite a settings file it cannot parse", () => {
    const pluginRoot = builtPluginRoot();
    const settingsPath = join(scratch(), "settings.json");
    writeFileSync(settingsPath, "{ not json");

    expect(() => installClaudeAdapter({ pluginRoot, settingsPath })).toThrow("could not be parsed");
    expect(readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });
});
