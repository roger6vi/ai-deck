import type { SessionState } from "../core/reducer";
import { CONTROL_CHARACTER_PATTERN, productionEnumeratorProcess, type TmuxPaneEnumeratorProcess } from "../persistence/session-state-reconciler";

export const SESSION_SLOT_TITLE_LIMITS = {
  MAX_NAME_LENGTH: 20,
  MAX_LINES: 3,
  // What fits across one key at its title size; typed names are cut to it.
  MAX_PANE_NAME_LINE_LENGTH: 10,
} as const;

// A name set from the inspector lives in this pane-scoped tmux user option;
// without one the key falls back to the window name, as before.
export const PANE_NAME_OPTION = "@aideck_name";
const PANE_ID_PATTERN = /^%\d+$/;
// Check emptiness explicitly: the valid custom name "0" is false in tmux conditionals.
const HAS_PANE_NAME = `#{!=:#{${PANE_NAME_OPTION}},}`;
// A one-byte tag keeps literal window-name pipes distinct from custom line separators.
const PANE_NAME_FORMAT = `#{?${HAS_PANE_NAME},1,0}#{?${HAS_PANE_NAME},#{${PANE_NAME_OPTION}},#{window_name}}`;

export interface SessionWindowNameResolver {
  resolve(paneId: string): Promise<string | undefined>;
}

export interface SessionPaneNamer {
  /** Sets the pane's name, or clears it when `name` sanitizes to nothing. */
  rename(paneId: string, name: string): Promise<void>;
}

export interface TmuxWindowNameResolverOptions {
  readonly process: TmuxPaneEnumeratorProcess;
}

const GLOBAL_CONTROL_CHARACTER_PATTERN = new RegExp(CONTROL_CHARACTER_PATTERN.source, "g");

// tmux prints control characters as "_" when a client outside tmux asks for
// them (display-message -p), so a name cannot cross it with real line breaks.
// It is stored on one line with this separator instead, and split on the way
// back; typing it is the same as pressing Enter.
const LINE_SEPARATOR = "|";

function sanitizeLines(raw: string, maxLineLength: number): string | undefined {
  const lines = raw
    .split(/\r?\n|\|/)
    .map((line) => line.replaceAll(GLOBAL_CONTROL_CHARACTER_PATTERN, "").trim().slice(0, maxLineLength).trim())
    .filter((line) => line.length > 0)
    .slice(0, SESSION_SLOT_TITLE_LIMITS.MAX_LINES);
  return lines.length === 0 ? undefined : lines.join("\n");
}

function sanitizeWindowName(raw: string): string | undefined {
  const cleaned = raw.replaceAll(GLOBAL_CONTROL_CHARACTER_PATTERN, "").trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH);
}

// tmux parses an argument starting with "-" as a flag, and does not accept
// "--" to stop that, so leading dashes are dropped from user-typed names.
export function sanitizePaneName(raw: string): string | undefined {
  return sanitizeLines(raw.replace(/^\s*-+/, ""), SESSION_SLOT_TITLE_LIMITS.MAX_PANE_NAME_LINE_LENGTH);
}

export function createTmuxPaneNamer(options: TmuxWindowNameResolverOptions = { process: productionEnumeratorProcess }): SessionPaneNamer {
  return {
    async rename(paneId, name) {
      if (!PANE_ID_PATTERN.test(paneId)) return;
      const cleaned = sanitizePaneName(name);
      if (cleaned === undefined) {
        await options.process.execute("tmux", ["set-option", "-p", "-u", "-t", paneId, PANE_NAME_OPTION]);
        return;
      }
      await options.process.execute("tmux", ["set-option", "-p", "-t", paneId, PANE_NAME_OPTION, cleaned.replaceAll("\n", LINE_SEPARATOR)]);
      // A pane title is one line, and select-pane -T expands formats, so lines
      // are joined and a literal "#" is doubled.
      await options.process.execute("tmux", ["select-pane", "-t", paneId, "-T", cleaned.replaceAll("\n", " ").replaceAll("#", "##")]);
    },
  };
}

export function createTmuxWindowNameResolver(options: TmuxWindowNameResolverOptions = { process: productionEnumeratorProcess }): SessionWindowNameResolver {
  return {
    async resolve(paneId) {
      try {
        const { stdout } = await options.process.execute("tmux", ["display-message", "-t", paneId, "-p", PANE_NAME_FORMAT]);
        if (stdout.startsWith("1")) return sanitizeLines(stdout.slice(1), SESSION_SLOT_TITLE_LIMITS.MAX_PANE_NAME_LINE_LENGTH);
        return stdout.startsWith("0") ? sanitizeWindowName(stdout.slice(1)) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export function resolveSlotTitles(
  state: SessionState,
  windowNameFor: (paneId: string) => string | undefined,
): readonly (string | undefined)[] {
  const names = state.slots.map((slot) => {
    if (slot.sessionId === undefined || slot.target === undefined) return undefined;
    return windowNameFor(slot.target.tmuxPaneId);
  });
  const occurrences = new Map<string, number>();
  for (const name of names) {
    if (name !== undefined) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  }
  return names.map((name, index) => {
    if (name === undefined) return undefined;
    // Every slot sharing a name is marked; leaving one bare would identify it
    // only by elimination. The pane id goes on its own line because beside the
    // name it is unreadable at key size.
    if ((occurrences.get(name) ?? 0) < 2) return name;
    const paneId = state.slots[index]?.target?.tmuxPaneId;
    return paneId === undefined ? name : `${name}\n·${paneId}`;
  });
}
