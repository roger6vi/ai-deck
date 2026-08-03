import { reduceSessionState, SESSION_REDUCER_ACTION, type SessionState } from "../core/reducer";
import { createBoundedNavigationProcess } from "../navigation/ghostty-tmux";

const TMUX_PANE_PATTERN = /^%\d{1,20}$/;
export const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;

export interface TmuxPaneEnumeratorProcess {
  execute(command: string, args: readonly string[]): Promise<{ readonly stdout: string }>;
}

export interface TmuxPaneEnumerator {
  enumerate(): Promise<ReadonlySet<string> | undefined>;
}

export interface TmuxPaneEnumeratorOptions {
  readonly process: TmuxPaneEnumeratorProcess;
}

export function reconcileSessionState(state: SessionState, existingPaneIds: ReadonlySet<string> | undefined): SessionState {
  if (existingPaneIds === undefined) return state;
  let result = state;
  for (const slot of state.slots) {
    if (slot.target === undefined || slot.sessionId === undefined || slot.assignmentId === undefined) continue;
    if (existingPaneIds.has(slot.target.tmuxPaneId)) continue;
    result = reduceSessionState(result, {
      kind: SESSION_REDUCER_ACTION.PANE_MISSING,
      slotIndex: slot.index,
      sessionId: slot.sessionId,
      target: slot.target,
      assignmentId: slot.assignmentId,
    });
  }
  return result;
}

export const productionEnumeratorProcess: TmuxPaneEnumeratorProcess = createBoundedNavigationProcess();

export function createTmuxPaneEnumerator(options: TmuxPaneEnumeratorOptions = { process: productionEnumeratorProcess }): TmuxPaneEnumerator {
  return {
    async enumerate() {
      try {
        const { stdout } = await options.process.execute("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
        const panes = new Set<string>();
        for (const line of stdout.split("\n")) {
          if (line.length === 0) continue;
          if (CONTROL_CHARACTER_PATTERN.test(line)) continue;
          if (!TMUX_PANE_PATTERN.test(line)) continue;
          panes.add(line);
        }
        return panes;
      } catch {
        return undefined;
      }
    },
  };
}
