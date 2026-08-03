import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LocalAgentTargetMetadata } from "../core/types";
export const NAVIGATION_OUTCOME = { NAVIGATED: "navigated", AMBIGUOUS: "ambiguous", MISSING: "missing", UNAVAILABLE: "unavailable" } as const;
export const NAVIGATION_PROCESS_LIMITS = { TIMEOUT_MS: 200, MAX_OUTPUT_BYTES: 16 * 1024 } as const;
export const NAVIGATION_TERMINATION_LIMITS = { GRACE_MS: 50 } as const;
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty"; const TMUX_PANE_PATTERN = /^%\d+$/; const TMUX_SESSION_PATTERN = /^\$\d+$/; const TMUX_WINDOW_PATTERN = /^@\d+$/;
export type NavigationOutcome = (typeof NAVIGATION_OUTCOME)[keyof typeof NAVIGATION_OUTCOME];
export interface NavigationProcessResult { readonly stdout: string; }
export interface NavigationProcess { execute(command: string, args: readonly string[]): Promise<NavigationProcessResult>; }
export interface NavigationChild { kill(signal: "SIGTERM" | "SIGKILL"): void; }
export interface NavigationExecution { readonly child: NavigationChild; readonly result: Promise<NavigationProcessResult>; }
export interface NavigationLauncher { launch(command: string, args: readonly string[], maxOutputBytes: number): NavigationExecution; }
export interface NavigationTimer { schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void; }
export interface AssignedTargetNavigator { navigate(target: LocalAgentTargetMetadata): Promise<NavigationOutcome>; }
export interface GhosttyTmuxNavigatorOptions { readonly process: NavigationProcess; }
/**
 * The Stream Deck app launches the plugin with the macOS GUI PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), which has no Homebrew in it. Resolving
 * binaries explicitly is what keeps `tmux` reachable from the plugin process.
 */
export const COMMAND_SEARCH_PATHS: readonly string[] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

export interface CommandPathDependencies { readonly exists: (path: string) => boolean; readonly env: NodeJS.ProcessEnv; }

export function resolveCommandPath(command: string, dependencies: CommandPathDependencies = { exists: existsSync, env: process.env }): string {
  if (command.includes("/")) return command;
  const override = dependencies.env[`AI_DECK_${command.toUpperCase()}`];
  if (override !== undefined && override.length > 0 && dependencies.exists(override)) return override;
  for (const directory of COMMAND_SEARCH_PATHS) {
    const candidate = join(directory, command);
    if (dependencies.exists(candidate)) return candidate;
  }
  return command;
}

const productionLauncher: NavigationLauncher = { launch(rawCommand, args, maxOutputBytes) {
  const command = resolveCommandPath(rawCommand);
  let child: ReturnType<typeof execFile>; let resolve: (result: NavigationProcessResult) => void = () => undefined; let reject: () => void = () => undefined;
  const result = new Promise<NavigationProcessResult>((next, fail) => { resolve = next; reject = () => fail(new Error("Navigation process unavailable.")); });
  child = execFile(command, args, { encoding: "utf8", maxBuffer: maxOutputBytes, shell: false }, (error, stdout) => { if (error === null) resolve({ stdout }); else reject(); });
  return { child: { kill: (signal) => { child.kill(signal); } }, result };
} };
export function createBoundedNavigationProcess(options: { readonly launcher: NavigationLauncher; readonly timer: NavigationTimer } = { launcher: productionLauncher, timer: { schedule: (callback, delayMs) => setTimeout(callback, delayMs), cancel: clearTimeout } }): NavigationProcess {
  return { execute(command, args) {
    const execution = options.launcher.launch(command, args, NAVIGATION_PROCESS_LIMITS.MAX_OUTPUT_BYTES);
    return new Promise((resolve, reject) => {
      let settled = false; let killTimer: unknown; let terminateTimer: unknown;
      const finish = (result?: NavigationProcessResult) => { if (settled) return; settled = true; options.timer.cancel(terminateTimer); if (killTimer !== undefined) options.timer.cancel(killTimer); result === undefined ? reject(new Error("Navigation process unavailable.")) : resolve(result); };
      terminateTimer = options.timer.schedule(() => { execution.child.kill("SIGTERM"); killTimer = options.timer.schedule(() => { execution.child.kill("SIGKILL"); finish(); }, NAVIGATION_TERMINATION_LIMITS.GRACE_MS); }, NAVIGATION_PROCESS_LIMITS.TIMEOUT_MS);
      void execution.result.then((result) => finish(result), () => finish());
    });
  } };
}
const productionNavigationProcess = createBoundedNavigationProcess();
function isSafeTarget(target: LocalAgentTargetMetadata): boolean { return TMUX_PANE_PATTERN.test(target.tmuxPaneId) && TMUX_SESSION_PATTERN.test(target.tmuxSession) && (target.tmuxWindow === undefined || TMUX_WINDOW_PATTERN.test(target.tmuxWindow)) && target.ghosttyBundleId === GHOSTTY_BUNDLE_ID; }
function rows(stdout: string): readonly (readonly string[])[] { return stdout.split("\n").filter((line) => line.length > 0).map((line) => line.split("\t")); }
function exactPaneRow(stdout: string, target: LocalAgentTargetMetadata): readonly string[] | undefined { return rows(stdout).find((row) => row.length === 3 && row.every((field) => !/[\x00-\x1f\x7f]/.test(field)) && TMUX_WINDOW_PATTERN.test(row[2] ?? "") && row[0] === target.tmuxPaneId && row[1] === target.tmuxSession && (target.tmuxWindow === undefined || row[2] === target.tmuxWindow)); }
function targetableClients(stdout: string, target: LocalAgentTargetMetadata): readonly string[] { return rows(stdout).filter((row) => row.length === 2 && row.every((field) => !/[\x00-\x1f\x7f]/.test(field)) && /^\/dev\/[A-Za-z0-9._-]+$/.test(row[0] ?? "") && row[1] === target.tmuxSession).map(([tty]) => tty ?? ""); }
export function createGhosttyTmuxNavigator(options: GhosttyTmuxNavigatorOptions = { process: productionNavigationProcess }): AssignedTargetNavigator { return { async navigate(target): Promise<NavigationOutcome> {
      if (!isSafeTarget(target)) return NAVIGATION_OUTCOME.UNAVAILABLE;
      let paneOutput: string; try {
        await options.process.execute("tmux", ["has-session", "-t", target.tmuxSession]);
        paneOutput = (await options.process.execute("tmux", ["list-panes", "-a", "-F", "#{pane_id}\t#{session_id}\t#{window_id}"])).stdout;
      } catch {
        return NAVIGATION_OUTCOME.UNAVAILABLE;
      }
      const paneRow = exactPaneRow(paneOutput, target);
      const windowId = paneRow?.[2];
      if (paneRow === undefined || windowId === undefined) return NAVIGATION_OUTCOME.MISSING;
      let clients: readonly string[]; try {
        clients = targetableClients((await options.process.execute("tmux", ["list-clients", "-F", "#{client_tty}\t#{session_id}"])).stdout, target);
      } catch {
        return NAVIGATION_OUTCOME.UNAVAILABLE;
      }
      if (clients.length !== 1) return NAVIGATION_OUTCOME.AMBIGUOUS;
      const client = clients[0]; if (client === undefined) return NAVIGATION_OUTCOME.AMBIGUOUS; try {
        await options.process.execute("open", ["-b", target.ghosttyBundleId]);
        await options.process.execute("tmux", ["switch-client", "-c", client, "-t", target.tmuxSession]);
        await options.process.execute("tmux", ["select-window", "-t", windowId]);
        await options.process.execute("tmux", ["select-pane", "-t", target.tmuxPaneId]);
      } catch {
        return NAVIGATION_OUTCOME.UNAVAILABLE;
      }
      return NAVIGATION_OUTCOME.NAVIGATED;
    } }; }
export const ghosttyTmuxNavigator = createGhosttyTmuxNavigator();
