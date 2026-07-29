import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { SESSION_SLOT_ACTION_UUID } from "../src/actions/session-slot.constants";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSETS_DIRECTORY = resolve(PROJECT_ROOT, "com.gentleman.ai-deck.sdPlugin/assets");
const ASSET_DIMENSIONS = {
  "plugin.png": 256,
  "plugin@2x.png": 512,
  "action.png": 20,
  "action@2x.png": 40,
  "key.png": 72,
  "key@2x.png": 144,
} as const;
const ACTION_ASSETS = ["action.png", "action@2x.png"] as const;
const temporaryDirectories: string[] = [];
const PNG_SIGNATURE_OFFSET = 0;
const PNG_SIGNATURE_LENGTH = 8;
const PNG_CHUNK_LENGTH_OFFSET = 0;
const PNG_CHUNK_TYPE_OFFSET = 4;
const PNG_CHUNK_DATA_OFFSET = 8;
const PNG_CHUNK_CRC_WIDTH = 4;
const PNG_HEADER_LENGTH = 13;
const PNG_HEADER_WIDTH_OFFSET = 0;
const PNG_HEADER_HEIGHT_OFFSET = 4;
const RGBA_BYTES_PER_PIXEL = 4;
const PNG_FILTER_BYTES_PER_ROW = 1;
const PNG_FILTER_TYPE_NONE = 0;

function inspectPng(png: Buffer) {
  const chunkOffset = PNG_SIGNATURE_OFFSET + PNG_SIGNATURE_LENGTH;
  const headerLength = png.readUInt32BE(chunkOffset + PNG_CHUNK_LENGTH_OFFSET);
  const headerStart = chunkOffset + PNG_CHUNK_DATA_OFFSET;
  const width = png.readUInt32BE(headerStart + PNG_HEADER_WIDTH_OFFSET);
  const height = png.readUInt32BE(headerStart + PNG_HEADER_HEIGHT_OFFSET);
  let offset = chunkOffset;
  const imageData: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset + PNG_CHUNK_LENGTH_OFFSET);
    const type = png
      .subarray(offset + PNG_CHUNK_TYPE_OFFSET, offset + PNG_CHUNK_DATA_OFFSET)
      .toString("ascii");
    const dataStart = offset + PNG_CHUNK_DATA_OFFSET;
    if (type === "IDAT") imageData.push(png.subarray(dataStart, dataStart + length));
    offset = dataStart + length + PNG_CHUNK_CRC_WIDTH;
  }

  return { headerLength, width, height, pixels: inflateSync(Buffer.concat(imageData)) };
}

async function listHashes(directory: string) {
  const files = await readdir(directory);
  const hashes = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(resolve(directory, file));
      return [file, createHash("sha256").update(contents).digest("hex")] as const;
    }),
  );
  return new Map(hashes);
}

async function generateAssets(directory: string) {
  const processResult = await new Promise<number | null>((resolveProcess, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/build-assets.mjs", "--output-directory", directory],
      {
        cwd: PROJECT_ROOT,
        stdio: "ignore",
      },
    );
    child.once("error", reject);
    child.once("close", resolveProcess);
  });

  expect(processResult).toBe(0);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("plugin delivery contract", () => {
  it("keeps the manifest action contract and asset paths", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(PROJECT_ROOT, "com.gentleman.ai-deck.sdPlugin/manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const actions = manifest.Actions as Array<Record<string, unknown>>;
    const action = actions[0];
    if (!action) throw new Error("Manifest must contain its reserved action.");
    expect(manifest.CodePath).toBe("bin/plugin.js");
    expect(actions).toHaveLength(1);
    expect(action).toMatchObject({
      Name: "Reserved Session Slot",
      UUID: SESSION_SLOT_ACTION_UUID,
      DeviceType: 0,
    });
    expect(action).not.toHaveProperty("Profiles");
    const state = (action.States as Array<Record<string, unknown>>)[0];
    if (!state) throw new Error("Reserved action must contain its key state.");
    const assetPaths = [manifest.Icon, action.Icon, state.Image];
    expect(assetPaths).toEqual(["assets/plugin", "assets/action", "assets/key"]);
    expect(new Set(assetPaths)).toHaveLength(3);
  });

  it("ships the six manifest-referenced PNGs at exact dimensions", async () => {
    await Promise.all(
      Object.entries(ASSET_DIMENSIONS).map(async ([file, size]) => {
        const png = inspectPng(await readFile(resolve(ASSETS_DIRECTORY, file)));
        expect(png.headerLength).toBe(PNG_HEADER_LENGTH);
        expect([png.width, png.height]).toEqual([size, size]);
      }),
    );
  });

  it("renders action-list icons as white foreground over transparent background", async () => {
    for (const file of ACTION_ASSETS) {
      const { width, pixels } = inspectPng(await readFile(resolve(ASSETS_DIRECTORY, file)));
      const stride = width * RGBA_BYTES_PER_PIXEL + PNG_FILTER_BYTES_PER_ROW;
      let transparentPixelCount = 0;
      let opaquePixelCount = 0;
      for (let row = 0; row < width; row += 1) {
        expect(pixels[row * stride]).toBe(PNG_FILTER_TYPE_NONE);
        for (let column = 0; column < width; column += 1) {
          const offset =
            row * stride + PNG_FILTER_BYTES_PER_ROW + column * RGBA_BYTES_PER_PIXEL;
          const [red, green, blue, alpha] = pixels.subarray(
            offset,
            offset + RGBA_BYTES_PER_PIXEL,
          );
          expect([red, green, blue]).toEqual([255, 255, 255]);
          if (alpha === 0) transparentPixelCount += 1;
          if (alpha === 255) opaquePixelCount += 1;
        }
      }

      expect(transparentPixelCount).toBeGreaterThan(0);
      expect(opaquePixelCount).toBeGreaterThan(0);
    }
  });

  it("generates byte-identical assets in isolated directories", async () => {
    const firstDirectory = await mkdtemp(resolve(tmpdir(), "ai-deck-assets-"));
    const secondDirectory = await mkdtemp(resolve(tmpdir(), "ai-deck-assets-"));
    temporaryDirectories.push(firstDirectory, secondDirectory);
    await generateAssets(firstDirectory);
    await generateAssets(secondDirectory);

    const firstHashes = await listHashes(firstDirectory);
    const secondHashes = await listHashes(secondDirectory);
    const repositoryHashes = await listHashes(ASSETS_DIRECTORY);
    const expectedFiles = Object.keys(ASSET_DIMENSIONS).sort();
    expect([...firstHashes.keys()].sort()).toEqual(expectedFiles);
    expect([...secondHashes.keys()].sort()).toEqual(expectedFiles);
    expect([...repositoryHashes.keys()].sort()).toEqual(expectedFiles);
    expect(firstHashes).toEqual(secondHashes);
    expect(firstHashes).toEqual(repositoryHashes);
    expect(secondHashes).toEqual(repositoryHashes);
  });
});
