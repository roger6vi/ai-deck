import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// PNG file-format constants.
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CHUNK_TYPE = {
  HEADER: "IHDR",
  IMAGE_DATA: "IDAT",
  END: "IEND",
};
const PNG_COLOR_TYPE_RGBA = 6;
const PNG_HEADER_LENGTH = 13;
const PNG_HEADER_WIDTH_OFFSET = 0;
const PNG_HEADER_HEIGHT_OFFSET = 4;
const PNG_HEADER_BIT_DEPTH_OFFSET = 8;
const PNG_HEADER_COLOR_TYPE_OFFSET = 9;
const PNG_BIT_DEPTH = 8;
const PNG_CRC32_INITIAL_VALUE = 0xffffffff;
const PNG_CRC32_POLYNOMIAL = 0xedb88320;
const RGBA_BYTES_PER_PIXEL = 4;
const PNG_FILTER_BYTES_PER_ROW = 1;
const PNG_FILTER_TYPE_NONE = 0;

// Chosen icon visual defaults.
const PLUGIN_ICON_SIZE = 256;
const ACTION_ICON_SIZE = 20;
const KEY_IMAGE_SIZE = 72;
const CATEGORY_ICON_SIZE = 28;
const ICON_DOUBLE_SCALE = 2;
const ICON_INSET_RATIO = 0.3;
const ACTION_INSET_RATIO = 0.2;
const ICON_BACKGROUND_COLOR = [31, 31, 40, 255];
const ICON_FOREGROUND_COLOR = [122, 162, 247, 255];
const ACTION_FOREGROUND_COLOR = [255, 255, 255, 255];
const ACTION_BACKGROUND_COLOR = [255, 255, 255, 0];
const ASSET_FILES = [
  ["plugin.png", PLUGIN_ICON_SIZE, createIconPixels],
  ["plugin@2x.png", PLUGIN_ICON_SIZE * ICON_DOUBLE_SCALE, createIconPixels],
  ["action.png", ACTION_ICON_SIZE, createActionPixels],
  ["action@2x.png", ACTION_ICON_SIZE * ICON_DOUBLE_SCALE, createActionPixels],
  ["key.png", KEY_IMAGE_SIZE, createIconPixels],
  ["key@2x.png", KEY_IMAGE_SIZE * ICON_DOUBLE_SCALE, createIconPixels],
  ["category-icon.png", CATEGORY_ICON_SIZE, createActionPixels],
  ["category-icon@2x.png", CATEGORY_ICON_SIZE * ICON_DOUBLE_SCALE, createActionPixels],
];

function crc32(data) {
  let value = PNG_CRC32_INITIAL_VALUE;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const hasLeastSignificantBit = (value & 1) === 1;

      value = value >>> 1;
      if (hasLeastSignificantBit) {
        value ^= PNG_CRC32_POLYNOMIAL;
      }
    }
  }

  return (value ^ PNG_CRC32_INITIAL_VALUE) >>> 0;
}

function createPngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  const checksumData = Buffer.concat([typeBytes, data]);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(checksumData));

  return Buffer.concat([length, typeBytes, data, checksum]);
}

function createIconPixels(size) {
  const bytesPerRow = size * RGBA_BYTES_PER_PIXEL + PNG_FILTER_BYTES_PER_ROW;
  const pixels = Buffer.alloc(bytesPerRow * size);
  const inset = size * ICON_INSET_RATIO;
  for (let y = 0; y < size; y += 1) {
    pixels[y * bytesPerRow] = PNG_FILTER_TYPE_NONE;
    for (let x = 0; x < size; x += 1) {
      const isInsideInset =
        x >= inset &&
        x < size - inset &&
        y >= inset &&
        y < size - inset;
      const color = isInsideInset ? ICON_FOREGROUND_COLOR : ICON_BACKGROUND_COLOR;
      const pixelOffset =
        y * bytesPerRow + PNG_FILTER_BYTES_PER_ROW + x * RGBA_BYTES_PER_PIXEL;

      pixels.set(color, pixelOffset);
    }
  }

  return pixels;
}

function createActionPixels(size) {
  const bytesPerRow = size * RGBA_BYTES_PER_PIXEL + PNG_FILTER_BYTES_PER_ROW;
  const pixels = Buffer.alloc(bytesPerRow * size);
  const inset = size * ACTION_INSET_RATIO;
  for (let y = 0; y < size; y += 1) {
    pixels[y * bytesPerRow] = PNG_FILTER_TYPE_NONE;
    for (let x = 0; x < size; x += 1) {
      const isInsideInset =
        x > inset && x < size - inset && y > inset && y < size - inset;
      const color = isInsideInset ? ACTION_FOREGROUND_COLOR : ACTION_BACKGROUND_COLOR;
      const pixelOffset =
        y * bytesPerRow + PNG_FILTER_BYTES_PER_ROW + x * RGBA_BYTES_PER_PIXEL;

      pixels.set(color, pixelOffset);
    }
  }
  return pixels;
}

function createPng(size, pixels = createIconPixels(size)) {
  const header = Buffer.alloc(PNG_HEADER_LENGTH);
  header.writeUInt32BE(size, PNG_HEADER_WIDTH_OFFSET);
  header.writeUInt32BE(size, PNG_HEADER_HEIGHT_OFFSET);
  header[PNG_HEADER_BIT_DEPTH_OFFSET] = PNG_BIT_DEPTH;
  header[PNG_HEADER_COLOR_TYPE_OFFSET] = PNG_COLOR_TYPE_RGBA;

  return Buffer.concat([
    PNG_SIGNATURE,
    createPngChunk(PNG_CHUNK_TYPE.HEADER, header),
    createPngChunk(PNG_CHUNK_TYPE.IMAGE_DATA, deflateSync(pixels)),
    createPngChunk(PNG_CHUNK_TYPE.END, Buffer.alloc(0)),
  ]);
}

function getOutputDirectory() {
  const outputArgumentIndex = process.argv.indexOf("--output-directory");
  const outputArgument =
    outputArgumentIndex === -1 ? undefined : process.argv[outputArgumentIndex + 1];
  if (outputArgumentIndex !== -1 && !outputArgument) {
    throw new Error("--output-directory requires a directory path.");
  }

  return resolve(
    outputArgument ??
    process.env.AI_DECK_ASSET_DIRECTORY ??
    fileURLToPath(new URL("../com.gentleman.ai-deck.sdPlugin/assets/", import.meta.url)),
  );
}

const outputDirectory = getOutputDirectory();
await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  ASSET_FILES.map(([fileName, size, createPixels]) =>
    writeFile(resolve(outputDirectory, fileName), createPng(size, createPixels(size))),
  ),
);
