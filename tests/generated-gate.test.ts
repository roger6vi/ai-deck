import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GENERATED_OUTPUTS,
  assertGeneratedArtifacts,
  assertGeneratedState,
  classifyGeneratedStatus,
} from "../scripts/check-generated.mjs";
import * as profileContract from "../scripts/profile-contract.mjs";
import { PROFILE_FILE } from "../scripts/profile-contract.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const ASSETS = "com.gentleman.ai-deck.sdPlugin/assets";
const PROFILE = join(ROOT, PROFILE_FILE);
const temporaryDirectories: string[] = [];

interface PackageJson {
  engines: { node: string };
  scripts: Record<string, string>;
}

async function copyGeneratedOutputs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-deck-generated-"));
  temporaryDirectories.push(root);
  await cp(join(ROOT, ASSETS), join(root, ASSETS), { recursive: true });
  await cp(PROFILE, join(root, PROFILE_FILE));
  return root;
}

afterEach(() =>
  Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  ),
);

describe("generated-output gate", () => {
  const output = `${ASSETS}/plugin.png`;

  it.each([
    ["clean", [], []],
    ["staged addition", [`A  ${output}`], []],
    ["untracked", [`?? ${output}`], [`?? ${output}`]],
    ["unstaged", [` M ${output}`], [` M ${output}`]],
    ["deletion", [`D  ${output}`], [`D  ${output}`]],
    ["rename", [`R  ${output} -> old.png`], [`R  ${output} -> old.png`]],
    [
      "mixed",
      [`A  ${output}`, `?? ${ASSETS}/key.png`, ` M ${PROFILE_FILE}`],
      [`?? ${ASSETS}/key.png`, ` M ${PROFILE_FILE}`],
    ],
  ])("classifies %s state", (_name, status, driftedOutputs) => {
    expect(classifyGeneratedStatus(status)).toEqual({
      isAcceptable: driftedOutputs.length === 0,
      driftedOutputs,
    });
    if (driftedOutputs.length === 0) {
      expect(() => assertGeneratedState(status)).not.toThrow();
    } else {
      expect(() => assertGeneratedState(status)).toThrow("Generated output");
    }
  });

  it("requires exactly six PNGs and the profile archive", async () => {
    await expect(assertGeneratedArtifacts(ROOT)).resolves.toBeUndefined();
    expect(GENERATED_OUTPUTS).toEqual([
      `${ASSETS}/plugin.png`,
      `${ASSETS}/plugin@2x.png`,
      `${ASSETS}/action.png`,
      `${ASSETS}/action@2x.png`,
      `${ASSETS}/key.png`,
      `${ASSETS}/key@2x.png`,
      PROFILE_FILE,
    ]);
  });

  it("rejects missing, extra, and byte-drifted outputs", async () => {
    const missing = await copyGeneratedOutputs();
    await unlink(join(missing, `${ASSETS}/plugin.png`));
    await expect(assertGeneratedArtifacts(missing)).rejects.toThrow("missing");

    const extra = await copyGeneratedOutputs();
    await writeFile(join(extra, `${ASSETS}/extra.png`), "extra");
    await expect(assertGeneratedArtifacts(extra)).rejects.toThrow("unexpected");

    const drifted = await copyGeneratedOutputs();
    const file = join(drifted, `${ASSETS}/plugin.png`);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([0])]));
    await expect(assertGeneratedArtifacts(drifted)).rejects.toThrow(
      "does not match deterministic generation",
    );
  });

  it("rejects nested directories and symbolic links in generated directories", async () => {
    const nestedDirectory = await copyGeneratedOutputs();
    await mkdir(join(nestedDirectory, ASSETS, "nested"));
    await expect(assertGeneratedArtifacts(nestedDirectory)).rejects.toThrow("regular files");

    const symbolicLink = await copyGeneratedOutputs();
    const assetDirectory = join(symbolicLink, ASSETS);
    await symlink(join(assetDirectory, "plugin.png"), join(assetDirectory, "linked.png"));
    await expect(assertGeneratedArtifacts(symbolicLink)).rejects.toThrow("regular files");
  });
});

describe("PR1D validation boundary", () => {
  it("does not expose or invoke public ZIP profile validation", async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as PackageJson;

    expect(profileContract).not.toHaveProperty("readProfileArchive");
    expect(profileContract).not.toHaveProperty("validateProfileArchive");
    expect(packageJson.scripts).not.toHaveProperty("validate:profile");
    await expect(access(join(ROOT, "scripts/validate-profile.mjs"))).rejects.toThrow();
  });

  it("keeps the Node 24 CI verification chain profile-validator free", async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as PackageJson;
    const workflow = await readFile(join(ROOT, ".github/workflows/verify.yml"), "utf8");
    const nvmrc = (await readFile(join(ROOT, ".nvmrc"), "utf8")).trim();
    const tsconfig = JSON.parse(await readFile(join(ROOT, "tsconfig.json"), "utf8")) as {
      compilerOptions: { lib: string[] };
    };
    const engines = packageJson.engines;

    expect(packageJson.scripts).toMatchObject({
      "audit:production": "npm audit --omit=dev --audit-level=low",
      "check:generated": "node scripts/check-generated.mjs",
      "validate:plugin": "streamdeck validate com.gentleman.ai-deck.sdPlugin --no-update-check",
      verify:
        "npm test && npm run typecheck && npm run audit:production && npm run build && npm run generate && npm run check:generated && npm run validate:plugin",
    });
    expect(workflow).toContain("node-version-file: .nvmrc");
    expect(nvmrc).toBe("24");
    expect(engines.node).toBe("24.x");
    expect(workflow).toMatch(/^      - run: npm ci$/m);
    expect(workflow).toMatch(/^      - run: npm run verify$/m);
    expect(tsconfig.compilerOptions.lib).toEqual(["ES2024", "DOM"]);
  });
});
