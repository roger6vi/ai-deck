import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

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
const PNG_CRC32_INITIAL_VALUE = 0xffffffff;
const PNG_CRC32_POLYNOMIAL = 0xedb88320;

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

function crc32(data: Buffer): number {
  let value = PNG_CRC32_INITIAL_VALUE;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? PNG_CRC32_POLYNOMIAL : 0);
  }
  return (value ^ PNG_CRC32_INITIAL_VALUE) >>> 0;
}

async function reencodeIdat(
  file: string,
  transformScanlines: (scanlines: Buffer) => Buffer = (scanlines) => scanlines,
  compressedSuffix: Buffer = Buffer.alloc(0),
): Promise<void> {
  const png = await readFile(file);
  const idatTypeOffset = png.indexOf(Buffer.from("IDAT"));
  const idatLengthOffset = idatTypeOffset - 4;
  const idatLength = png.readUInt32BE(idatLengthOffset);
  const idatDataOffset = idatTypeOffset + 4;
  const idatData = png.subarray(idatDataOffset, idatDataOffset + idatLength);
  const reencodedData = Buffer.concat([deflateSync(transformScanlines(inflateSync(idatData)), { level: 0 }), compressedSuffix]);
  const chunk = Buffer.alloc(reencodedData.length + 12);
  chunk.writeUInt32BE(reencodedData.length);
  chunk.write("IDAT", 4);
  reencodedData.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  await writeFile(file, Buffer.concat([png.subarray(0, idatLengthOffset), chunk, png.subarray(idatDataOffset + idatLength + 4)]));
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
      `${ASSETS}/category-icon.png`,
      `${ASSETS}/category-icon@2x.png`,
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

  it("accepts equivalent filtered scanline bytes regardless of deflate encoding", async () => {
    const equivalent = await copyGeneratedOutputs();
    await reencodeIdat(join(equivalent, ASSETS, "category-icon@2x.png"));

    await expect(assertGeneratedArtifacts(equivalent)).resolves.toBeUndefined();
  });

  it("rejects trailing compressed data and scanlines beyond the IHDR bound", async () => {
    for (const [suffix, transform] of [
      [Buffer.from([0]), (scanlines: Buffer) => scanlines],
      [Buffer.alloc(0), (scanlines: Buffer) => Buffer.concat([scanlines, Buffer.from([0])])],
    ] as const) {
      const invalid = await copyGeneratedOutputs();
      await reencodeIdat(join(invalid, ASSETS, "category-icon@2x.png"), transform, suffix);
      await expect(assertGeneratedArtifacts(invalid)).rejects.toThrow("does not match deterministic generation");
    }
  });

  it("rejects re-encoded PNGs when filtered scanline bytes drift", async () => {
    const drifted = await copyGeneratedOutputs();
    await reencodeIdat(join(drifted, ASSETS, "category-icon@2x.png"), (scanlines) => {
      const changedScanlines = Buffer.from(scanlines);
      const firstScanlineByte = changedScanlines[1];
      if (firstScanlineByte === undefined) throw new Error("PNG scanlines must be non-empty.");
      changedScanlines[1] = firstScanlineByte ^ 1;
      return changedScanlines;
    });

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

describe("canonical envelope boundary", () => {
  it("keeps profile-contract ZIP-reader free while exposing the canonical envelope CLI", async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as PackageJson;
    const envelopeSource = await readFile(join(ROOT, "scripts/profile-envelope.mjs"), "utf8");

    expect(profileContract).not.toHaveProperty("readProfileArchive");
    expect(profileContract).not.toHaveProperty("validateProfileArchive");
    expect(packageJson.scripts).toHaveProperty("validate:profile", "node scripts/validate-profile.mjs");
    expect(envelopeSource).not.toContain("zip.js");
    expect(envelopeSource).not.toContain("JSON.parse");
    expect(envelopeSource).not.toContain("getData");
    await expect(access(join(ROOT, "scripts/validate-profile.mjs"))).resolves.toBeUndefined();
  });

  it("runs canonical validation before the official plugin CLI", async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "audit:production": "npm audit --omit=dev --audit-level=low",
      "check:generated": "node scripts/check-generated.mjs",
      "validate:profile": "node scripts/validate-profile.mjs",
      "validate:plugin": "streamdeck validate com.gentleman.ai-deck.sdPlugin --no-update-check",
      verify: "npm test && npm run typecheck && npm run audit:production && npm run pack && npm run smoke:runtime",
    });
  });
});
