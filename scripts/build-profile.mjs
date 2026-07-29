import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import {
  PROFILE_DEVICE_MODEL,
  PROFILE_ENTRY_NAMES,
  PROFILE_FILE,
  PROFILE_FORMAT_VERSION,
  PROFILE_NAME,
  PROFILE_PAGE_ID,
  RESERVED_ACTION_NAME,
  SESSION_SLOT_ACTION_UUID,
  SESSION_SLOT_COORDINATES,
  stableActionId,
} from "./profile-contract.mjs";
// zip.js reads local time for DOS fields, so this must be a fixed local wall-clock date.
const FIXED_ARCHIVE_TIMESTAMP = new Date(2026, 0, 1, 0, 0, 0, 0);
const ZIP_COMPRESSION_LEVEL = 9;

// Visual defaults intentionally match the reserved action's readable white title treatment.
const PROFILE_STATE = 0;
const PROFILE_STATE_FONT_SIZE = 9;
const PROFILE_STATE_OUTLINE_THICKNESS = 2;
const PROFILE_TITLE_COLOR = "#ffffff";
function createSlots() {
  return Object.fromEntries(
    SESSION_SLOT_COORDINATES.map((coordinate) => [
      coordinate,
      {
        ActionID: stableActionId(coordinate),
        LinkedTitle: true,
        Name: RESERVED_ACTION_NAME,
        Settings: {},
        State: PROFILE_STATE,
        States: [
          {
            FontFamily: "",
            FontSize: PROFILE_STATE_FONT_SIZE,
            FontStyle: "",
            FontUnderline: false,
            OutlineThickness: PROFILE_STATE_OUTLINE_THICKNESS,
            ShowTitle: true,
            Title: `Reserved Slot ${Number.parseInt(coordinate, 10) + 1}`,
            TitleAlignment: "middle",
            TitleColor: PROFILE_TITLE_COLOR,
          },
        ],
        UUID: SESSION_SLOT_ACTION_UUID,
      },
    ]),
  );
}
function createTopLevelManifest() {
  return {
    Device: { Model: PROFILE_DEVICE_MODEL, UUID: "" },
    Name: PROFILE_NAME,
    Pages: { Current: PROFILE_PAGE_ID, Default: PROFILE_PAGE_ID, Pages: [PROFILE_PAGE_ID] },
    Version: PROFILE_FORMAT_VERSION,
  };
}
function createPageManifest() {
  return {
    Controllers: [{ Actions: createSlots(), Type: "Keypad" }],
    Icon: "",
    Name: "",
  };
}

export async function buildProfile(outputPath = PROFILE_FILE) {
  const archive = new ZipWriter(new BlobWriter("application/zip"));
  const options = {
    extendedTimestamp: false,
    lastModDate: FIXED_ARCHIVE_TIMESTAMP,
    level: ZIP_COMPRESSION_LEVEL,
  };

  await archive.add(PROFILE_ENTRY_NAMES[0], new TextReader(JSON.stringify(createTopLevelManifest())), options);
  await archive.add(PROFILE_ENTRY_NAMES[1], new TextReader(JSON.stringify(createPageManifest())), options);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(await (await archive.close()).arrayBuffer()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildProfile();
}
