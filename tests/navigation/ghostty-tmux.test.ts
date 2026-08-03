import { describe, expect, it, vi } from "vitest";
import { NAVIGATION_OUTCOME, NAVIGATION_PROCESS_LIMITS, createBoundedNavigationProcess, createGhosttyTmuxNavigator, type NavigationLauncher, type NavigationProcessResult, type NavigationTimer } from "../../src/navigation/ghostty-tmux";
const target = { tmuxPaneId: "%1", tmuxSession: "$0", ghosttyBundleId: "com.mitchellh.ghostty" } as const;
function processFor(outputs: readonly string[]) {
  const execute = vi.fn<(command: string, args: readonly string[]) => Promise<{ readonly stdout: string }>>();
  for (const stdout of outputs) execute.mockResolvedValueOnce({ stdout });
  return { execute };
}
describe("Ghostty tmux navigator", () => {
  it("uses explicit argv to navigate one validated pane through one targetable client", async () => {
    const process = processFor(["", "%1\t$0\t@1\n", "/dev/ttys001\t$0\n", "", "", "", ""]);
    const outcome = await createGhosttyTmuxNavigator({ process }).navigate(target);
    expect(outcome).toBe(NAVIGATION_OUTCOME.NAVIGATED);
    expect(process.execute.mock.calls).toEqual([["tmux", ["has-session", "-t", "$0"]], ["tmux", ["list-panes", "-a", "-F", "#{pane_id}\t#{session_id}\t#{window_id}"]], ["tmux", ["list-clients", "-F", "#{client_tty}\t#{session_id}"]], ["open", ["-b", target.ghosttyBundleId]], ["tmux", ["switch-client", "-c", "/dev/ttys001", "-t", "$0"]], ["tmux", ["select-window", "-t", "@1"]], ["tmux", ["select-pane", "-t", "%1"]]]);
  });
  it("returns missing without focusing when the pane is absent or its identifier was reused", async () => {
    for (const panes of ["", "%1\t$2\t@1\n", "%1\t$0\t@2\n", "%1\t$0\t@1\textra\n"]) {
      const process = processFor(["", panes]);
      const outcome = await createGhosttyTmuxNavigator({ process }).navigate({ ...target, tmuxWindow: "@1" });
      expect(outcome).toBe(NAVIGATION_OUTCOME.MISSING);
      expect(process.execute).toHaveBeenCalledTimes(2);
    }
    const invalid = processFor(["", "%1\t$0\tnot-a-window-id\n"]); expect(await createGhosttyTmuxNavigator({ process: invalid }).navigate(target)).toBe(NAVIGATION_OUTCOME.MISSING); expect(invalid.execute).toHaveBeenCalledTimes(2);
  });
  it("returns ambiguous without focusing for zero or multiple targetable clients", async () => {
    for (const clients of ["", "/dev/ttys001\t$0\n/dev/ttys002\t$0\n", "/dev/ttys001\u0000\t$0\n", "/dev/ttys 001\t$0\n"]) {
      const process = processFor(["", "%1\t$0\t@1\n", clients]);
      const outcome = await createGhosttyTmuxNavigator({ process }).navigate(target);
      expect(outcome).toBe(NAVIGATION_OUTCOME.AMBIGUOUS);
      expect(process.execute).toHaveBeenCalledTimes(3);
    }
  });
  it("contains every command-stage failure as unavailable", async () => {
    for (let failedAt = 0; failedAt < 7; failedAt += 1) {
      let call = 0; const outputs = ["", "%1\t$0\t@1\n", "/dev/ttys001\t$0\n", "", "", "", ""];
      const execute = vi.fn<(command: string, args: readonly string[]) => Promise<{ readonly stdout: string }>>().mockImplementation(() => Promise.resolve(call++ === failedAt ? Promise.reject(new Error("sensitive output")) : { stdout: outputs[call - 1] ?? "" }));
      expect(await createGhosttyTmuxNavigator({ process: { execute } }).navigate(target)).toBe(NAVIGATION_OUTCOME.UNAVAILABLE);
    }
  });
  it("settles a resistant child after TERM then KILL without leaking timers", async () => {
    const kill = vi.fn(); const timers: (() => void)[] = []; const launch = vi.fn<NavigationLauncher["launch"]>().mockImplementation(() => ({ child: { kill: (signal) => { kill(signal); } }, result: new Promise<NavigationProcessResult>(() => undefined) })); const launcher: NavigationLauncher = { launch };
    const timer: NavigationTimer = { schedule: (callback) => { timers.push(callback); return callback; }, cancel: vi.fn() };
    const pending = createBoundedNavigationProcess({ launcher, timer }).execute("tmux", []);
    const terminate = timers.shift(); if (terminate === undefined) throw new Error("Expected absolute timer."); terminate();
    const killTimer = timers.shift(); if (killTimer === undefined) throw new Error("Expected kill timer."); killTimer();
    await expect(pending).rejects.toThrow("Navigation process unavailable.");
    expect(launch).toHaveBeenCalledWith("tmux", [], NAVIGATION_PROCESS_LIMITS.MAX_OUTPUT_BYTES);
    expect(kill).toHaveBeenNthCalledWith(1, "SIGTERM"); expect(kill).toHaveBeenNthCalledWith(2, "SIGKILL"); expect(timer.cancel).toHaveBeenCalled();
  });
});
