import { describe, expect, it } from "vitest";

import { COMMAND_SEARCH_PATHS, resolveCommandPath } from "../../src/navigation/ghostty-tmux";

function existsIn(...present: readonly string[]): (path: string) => boolean {
  return (path) => present.includes(path);
}

describe("resolveCommandPath", () => {
  it("finds a Homebrew binary that the plugin's minimal PATH cannot see", () => {
    expect(resolveCommandPath("tmux", { exists: existsIn("/opt/homebrew/bin/tmux"), env: {} }))
      .toBe("/opt/homebrew/bin/tmux");
  });

  it("prefers the earliest search path when several copies exist", () => {
    expect(resolveCommandPath("tmux", { exists: existsIn("/usr/local/bin/tmux", "/usr/bin/tmux"), env: {} }))
      .toBe("/usr/local/bin/tmux");
    expect(COMMAND_SEARCH_PATHS.indexOf("/usr/local/bin")).toBeLessThan(COMMAND_SEARCH_PATHS.indexOf("/usr/bin"));
  });

  it("lets an explicit override win when it points at a real file", () => {
    expect(resolveCommandPath("tmux", { exists: existsIn("/custom/tmux", "/opt/homebrew/bin/tmux"), env: { AI_DECK_TMUX: "/custom/tmux" } }))
      .toBe("/custom/tmux");
  });

  it("ignores an override that does not exist", () => {
    expect(resolveCommandPath("tmux", { exists: existsIn("/opt/homebrew/bin/tmux"), env: { AI_DECK_TMUX: "/gone/tmux" } }))
      .toBe("/opt/homebrew/bin/tmux");
  });

  it("passes an explicit path straight through", () => {
    expect(resolveCommandPath("/somewhere/tmux", { exists: () => false, env: {} })).toBe("/somewhere/tmux");
  });

  it("falls back to the bare name so a normal PATH still resolves it", () => {
    expect(resolveCommandPath("tmux", { exists: () => false, env: {} })).toBe("tmux");
  });
});
