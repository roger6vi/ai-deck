import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { tmuxUtf8Args } from "../../src/navigation/ghostty-tmux";

describe("tmuxUtf8Args", () => {
  it("forces UTF-8 mode on every tmux invocation", () => {
    expect(tmuxUtf8Args("tmux", ["display-message", "-p", "#{pane_id}"])).toEqual([
      "-u",
      "display-message",
      "-p",
      "#{pane_id}",
    ]);
  });

  it("leaves non-tmux commands untouched", () => {
    expect(tmuxUtf8Args("open", ["-b", "com.mitchellh.ghostty"])).toEqual(["-b", "com.mitchellh.ghostty"]);
    expect(tmuxUtf8Args("osascript", ["-e", "on run argv"])).toEqual(["-e", "on run argv"]);
  });
});

// The Stream Deck app launches the plugin without a locale, and tmux prints
// accented option values as "_" to a client it does not believe is UTF-8.
describe("tmux without a UTF-8 locale (integration)", () => {
  const name = "animació";

  const tmuxPath = execFileSync("which", ["tmux"], { encoding: "utf8" }).trim();

  function tmuxWithoutLocale(args: readonly string[]): string {
    // A bare environment reproduces the GUI launch deterministically: tmux
    // cannot infer a UTF-8 locale from it and mangles non-ASCII output.
    return execFileSync(tmuxPath, args, { env: {}, encoding: "utf8" }).trim();
  }

  it("mangles accented names without -u and keeps them with -u", () => {
    if (tmuxPath === "") return;
    const socket = `aideck-utf8-${process.pid}`;
    try {
      execFileSync("tmux", ["-L", socket, "new-session", "-d", "-s", "utf8-check"]);
      const pane = execFileSync("tmux", ["-L", socket, "list-panes", "-t", "utf8-check", "-F", "#{pane_id}"]).toString().trim();
      execFileSync("tmux", ["-L", socket, "set-option", "-p", "-t", pane, "@aideck_name", name]);
      const format = "#{?#{!=:#{@aideck_name},},1,0}#{?#{!=:#{@aideck_name},},#{@aideck_name},#{window_name}}";

      expect(tmuxWithoutLocale(["-L", socket, "display-message", "-t", pane, "-p", format])).toBe(`1animaci_`);
      expect(tmuxWithoutLocale(["-u", "-L", socket, "display-message", "-t", pane, "-p", format])).toBe(`1${name}`);
    } finally {
      execFileSync("tmux", ["-L", socket, "kill-server"], { stdio: "ignore" });
    }
  });
});
