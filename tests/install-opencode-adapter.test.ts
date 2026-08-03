import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installOpenCodeAdapter } from "../scripts/install-opencode-adapter.mjs";

const temporary: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "ai-deck-install-"));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() ?? "", { recursive: true, force: true });
});

describe("installOpenCodeAdapter", () => {
  it("fails loudly when the bundled adapter is missing", () => {
    expect(() => installOpenCodeAdapter({ source: join(scratch(), "missing.js"), targetDirectory: scratch() }))
      .toThrow("npm run build");
  });

  it("copies the bundled adapter into the plugins directory and verifies the bytes", () => {
    const sourceDirectory = scratch();
    const targetDirectory = scratch();
    const source = join(sourceDirectory, "opencode-plugin.js");
    writeFileSync(source, "// bundled adapter\n");

    const target = installOpenCodeAdapter({ source, targetDirectory });

    expect(target).toBe(join(targetDirectory, "ai-deck.js"));
    expect(readFileSync(target, "utf8")).toBe("// bundled adapter\n");
  });
});
