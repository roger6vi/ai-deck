import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_HOOK_EVENTS = ["UserPromptSubmit", "Stop", "SessionEnd"];

const DEFAULT_PLUGIN_ROOT = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins", "com.gentleman.ai-deck.sdPlugin");
const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const HOOK_RELATIVE_PATH = join("bin", "claude-hook.js");
const HOOK_MARKER = "claude-hook.js";
const HOOK_TIMEOUT_SECONDS = 5;
const SHELL_UNSAFE_PATH = /["`$\\]/;

function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8").trim();
  if (raw === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${settingsPath} could not be parsed as a JSON object. Fix it before installing the ai-deck hook.`);
  }
  return parsed;
}

function withoutAiDeckHooks(entries) {
  return entries
    .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((hook) => !String(hook.command ?? "").includes(HOOK_MARKER)) }))
    .filter((entry) => entry.hooks.length > 0);
}

function quoteForShell(path, label) {
  if (SHELL_UNSAFE_PATH.test(path)) throw new Error(`${label} contains characters that cannot be quoted safely: ${path}`);
  return `"${path}"`;
}

export function installClaudeAdapter(options = {}) {
  const pluginRoot = options.pluginRoot ?? DEFAULT_PLUGIN_ROOT;
  const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const nodeBinary = options.nodeBinary ?? process.execPath;
  const hookPath = join(pluginRoot, HOOK_RELATIVE_PATH);
  if (!existsSync(hookPath)) {
    throw new Error(`Bundled Claude Code hook not found at ${hookPath}. Run \`npm run build\` first.`);
  }

  const settings = readSettings(settingsPath);
  const command = `AI_DECK_PLUGIN_ROOT=${quoteForShell(pluginRoot, "Plugin root")} ${quoteForShell(nodeBinary, "Node binary")} ${quoteForShell(hookPath, "Hook path")}`;
  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of CLAUDE_HOOK_EVENTS) {
    hooks[event] = [
      ...withoutAiDeckHooks(hooks[event] ?? []),
      { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] },
    ];
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`, "utf8");
  return settingsPath;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const settingsPath = installClaudeAdapter();
  console.log(`ai-deck: Claude Code hooks registered in ${settingsPath}`);
  console.log("ai-deck: restart any running Claude Code session to load them");
}
