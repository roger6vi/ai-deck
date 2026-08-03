import type { SessionState } from "../core/reducer";
import { CONTROL_CHARACTER_PATTERN, productionEnumeratorProcess, type TmuxPaneEnumeratorProcess } from "../persistence/session-state-reconciler";

export const SESSION_SLOT_TITLE_LIMITS = {
  MAX_NAME_LENGTH: 20,
} as const;

export interface SessionWindowNameResolver {
  resolve(paneId: string): Promise<string | undefined>;
}

export interface TmuxWindowNameResolverOptions {
  readonly process: TmuxPaneEnumeratorProcess;
}

const GLOBAL_CONTROL_CHARACTER_PATTERN = new RegExp(CONTROL_CHARACTER_PATTERN.source, "g");

function sanitizeWindowName(raw: string): string | undefined {
  const cleaned = raw.replaceAll(GLOBAL_CONTROL_CHARACTER_PATTERN, "").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, SESSION_SLOT_TITLE_LIMITS.MAX_NAME_LENGTH);
}

export function createTmuxWindowNameResolver(options: TmuxWindowNameResolverOptions = { process: productionEnumeratorProcess }): SessionWindowNameResolver {
  return {
    async resolve(paneId) {
      try {
        const { stdout } = await options.process.execute("tmux", ["display-message", "-t", paneId, "-p", "#{window_name}"]);
        return sanitizeWindowName(stdout);
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
  const seen = new Set<string>();
  return names.map((name, index) => {
    if (name === undefined) return undefined;
    if (!seen.has(name)) {
      seen.add(name);
      return name;
    }
    const paneId = state.slots[index]?.target?.tmuxPaneId;
    return paneId === undefined ? name : `${name} ·${paneId}`;
  });
}
