import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../scripts/migrate-profile.mjs", import.meta.url));
const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

const CURRENT_PLUGIN_UUID = "roger6vi.ai-deck";
const CURRENT_ACTION_UUID = "roger6vi.ai-deck.session-slot";
const PREVIOUS_IDENTITIES = [
  ["pre-release", "com.gentleman.ai-deck"],
  ["v0.1.0", "io.github.roger6vi.ai-deck"],
] as const;
const PROFILE_ARCHIVE_ROOT = "8E61C791-8708-42EA-9891-1554B6F0B5B8.sdProfile";
const ROOT_ENTRY = `${PROFILE_ARCHIVE_ROOT}/manifest.json`;
const PAGE_ENTRY = `${PROFILE_ARCHIVE_ROOT}/Profiles/TCT463B30T74L6S1LPIEFS6ST4Z/manifest.json`;
const ASSET_ENTRY = `${PROFILE_ARCHIVE_ROOT}/assets/background.png`;
const ASSET_JSON_ENTRY = `${PROFILE_ARCHIVE_ROOT}/assets/preset.json`;
const ASSET_MANIFEST_ENTRY = `${PROFILE_ARCHIVE_ROOT}/assets/manifest.json`;
const FIXED_TIMESTAMP = new Date(2026, 0, 1, 0, 0, 0, 0);
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x01]);
// Non-manifest JSON assets must be copied byte-for-byte, including whitespace
// and identity-looking values that are user data rather than action UUIDs.
const ASSET_JSON_BYTES = new TextEncoder().encode(
  '{  "note" : "io.github.roger6vi.ai-deck.session-slot",\n  "count" : 1.0, "nested": { "UUID": "io.github.roger6vi.ai-deck.session-slot" } }',
);
const SLOT_ACTION_ID = "d5cad140-85d7-5950-8a0f-006f806eec78";
const NESTED_ACTION_ID = "c0689340-dd29-557b-8fb9-69960a2cfc64";
const OTHER_PLUGIN_UUID = "com.elgato.streamdeck.system.open";
const MULTI_ACTION_UUID = "com.elgato.streamdeck.multiactions.routine2";
const USER_SETTINGS = {
  command: `echo ${CURRENT_ACTION_UUID}`,
  label: "Mixed nested keys",
  nested: { UUID: "not-a-plugin-identity", plugin: "io.github.roger6vi.ai-deck.session-slot" },
  // Decoys shaped exactly like the old action heuristic; they are user data.
  decoys: [
    { UUID: "io.github.roger6vi.ai-deck", Name: "My custom label" },
    { UUID: "io.github.roger6vi.ai-deck.session-slot", ActionID: "custom" },
    { UUID: "io.github.roger6vi.ai-deck.session-slot", States: [{ Title: "custom" }] },
  ],
};

interface ArchiveEntry {
  data: Uint8Array;
  name: string;
}

function slotAction(actionId: string, pluginUuid: string) {
  return {
    ActionID: actionId,
    LinkedTitle: true,
    Name: "Reserved Session Slot",
    Settings: USER_SETTINGS,
    State: 0,
    States: [
      {
        FontFamily: "",
        FontSize: 9,
        FontStyle: "",
        FontUnderline: false,
        OutlineThickness: 2,
        ShowTitle: true,
        Title: "Reserved Slot 1",
        TitleAlignment: "middle",
        TitleColor: "#ffffff",
      },
    ],
    UUID: `${pluginUuid}.session-slot`,
  };
}

function pageManifest(pluginUuid: string) {
  return {
    Controllers: [
      {
        Actions: {
          "0,0": slotAction(SLOT_ACTION_ID, pluginUuid),
          "1,0": {
            ActionID: NESTED_ACTION_ID,
            LinkedTitle: true,
            Name: "Open",
            Settings: {},
            State: 0,
            States: [{ Title: "Open", ShowTitle: true }],
            UUID: OTHER_PLUGIN_UUID,
          },
          "2,0": {
            ActionID: "11b3c78d-07ef-5f83-842a-31e64548985f",
            LinkedTitle: true,
            Name: "Multi Action",
            Settings: {
              Routine: {
                Actions: [slotAction("3ec08e95-6d5b-5a5c-8a61-986f83fc502e", pluginUuid)],
              },
            },
            State: 0,
            States: [{ Title: "Multi Action", ShowTitle: true }],
            UUID: MULTI_ACTION_UUID,
          },
        },
        Type: "Keypad",
      },
    ],
    Icon: "",
    Name: "",
  };
}

function rootManifest() {
  return {
    Device: { Model: "20GAA9901", UUID: "" },
    Name: "Local Agent Status",
    Pages: {
      Current: "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9",
      Default: "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9",
      Pages: ["eb3a430d-6307-4e4a-9b81-ae64e7f0dce9"],
    },
    Version: "2.0",
  };
}

async function writeArchive(path: string, entries: ArchiveEntry[]): Promise<void> {
  const archive = new ZipWriter(new BlobWriter("application/zip"));
  const options = { extendedTimestamp: false, lastModDate: FIXED_TIMESTAMP, level: 6 };
  for (const entry of entries) {
    const isText = entry.name.endsWith(".json");
    await archive.add(
      entry.name,
      isText ? new TextReader(new TextDecoder().decode(entry.data)) : new Uint8ArrayReader(entry.data),
      options,
    );
  }
  await writeFile(path, Buffer.from(await (await archive.close()).arrayBuffer()));
}

async function readArchive(path: string): Promise<Map<string, Uint8Array>> {
  const bytes = await readFile(path);
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
  try {
    const entries = await reader.getEntries();
    return new Map(
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.directory) throw new Error(`Unexpected directory entry ${entry.filename}.`);
          const data = await entry.getData(new Uint8ArrayWriter());
          return [entry.filename, data] as const;
        }),
      ),
    );
  } finally {
    await reader.close();
  }
}

function parseJson(entries: Map<string, Uint8Array>, name: string): Record<string, unknown> {
  const data = entries.get(name);
  if (!data) throw new Error(`Archive is missing ${name}.`);
  return JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
}

function rawText(entries: Map<string, Uint8Array>, name: string): string {
  const data = entries.get(name);
  if (!data) throw new Error(`Archive is missing ${name}.`);
  return new TextDecoder().decode(data);
}

/** Written as raw text so numeric tokens stay visible in the archive. */
function rawPageManifestText(pluginUuid: string): string {
  return `{
  "Controllers": [
    {
      "Actions": {
        "0,0": {
          "ActionID": "${SLOT_ACTION_ID}",
          "Name": "Reserved Session Slot",
          "Settings": {
            "recordId": 9007199254740993,
            "negativeZero": -0,
            "exponent": 1.5e3,
            "nested": { "inner": -2.50e-1, "list": [1E+2, 0.10] }
          },
          "States": [{ "Title": "Reserved Slot 1" }],
          "UUID": "${pluginUuid}.session-slot"
        }
      },
      "Type": "Keypad"
    }
  ],
  "Icon": "",
  "Name": ""
}`;
}

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-deck-migration-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeProfile(path: string, pluginUuid: string): Promise<void> {
  await writeArchive(path, [
    { data: new TextEncoder().encode(JSON.stringify(rootManifest())), name: ROOT_ENTRY },
    { data: new TextEncoder().encode(JSON.stringify(pageManifest(pluginUuid))), name: PAGE_ENTRY },
    { data: ASSET_BYTES, name: ASSET_ENTRY },
    { data: ASSET_JSON_BYTES, name: ASSET_JSON_ENTRY },
  ]);
}

async function runCli(args: string[], cwd?: string): Promise<{ code: number; stderr: string; stdout: string }> {
  try {
    const result = await executeFile(process.execPath, [CLI_PATH, ...args], cwd === undefined ? {} : { cwd });
    return { ...result, code: 0 };
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; stdout?: string };
    return { code: typeof failure.code === "number" ? failure.code : 1, stderr: failure.stderr ?? "", stdout: failure.stdout ?? "" };
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("exported profile identity migration", () => {
  it.each(PREVIOUS_IDENTITIES)("migrates a %s profile without touching unrelated data", async (_label, previousUuid) => {
    const directory = await fixtureDirectory();
    const input = join(directory, "exported.streamDeckProfile");
    const output = join(directory, "migrated.streamDeckProfile");
    await writeProfile(input, previousUuid);
    const inputBefore = await readFile(input);

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(output);
    expect(await readFile(input)).toEqual(inputBefore);

    const entries = await readArchive(output);
    expect([...entries.keys()].sort()).toEqual([ASSET_ENTRY, ASSET_JSON_ENTRY, PAGE_ENTRY, ROOT_ENTRY].sort());
    expect(entries.get(ASSET_ENTRY)).toEqual(ASSET_BYTES);
    expect(entries.get(ASSET_JSON_ENTRY)).toEqual(ASSET_JSON_BYTES);
    expect(parseJson(entries, ROOT_ENTRY)).toEqual(rootManifest());

    const page = parseJson(entries, PAGE_ENTRY) as any;
    const actions = page.Controllers[0].Actions;
    expect(actions["0,0"]).toEqual(slotAction(SLOT_ACTION_ID, CURRENT_PLUGIN_UUID));
    expect(actions["0,0"].UUID).toBe(CURRENT_ACTION_UUID);
    expect(actions["1,0"].UUID).toBe(OTHER_PLUGIN_UUID);
    expect(actions["1,0"].ActionID).toBe(NESTED_ACTION_ID);
    expect(actions["2,0"].UUID).toBe(MULTI_ACTION_UUID);
    expect(actions["2,0"].Settings.Routine.Actions[0]).toEqual(
      slotAction("3ec08e95-6d5b-5a5c-8a61-986f83fc502e", CURRENT_PLUGIN_UUID),
    );
    expect(actions["2,0"].Settings.Routine.Actions[0].ActionID).toBe(
      "3ec08e95-6d5b-5a5c-8a61-986f83fc502e",
    );
    // User content is preserved verbatim, including identity-looking strings in settings.
    expect(actions["0,0"].Settings).toEqual(USER_SETTINGS);
    expect(actions["0,0"].Settings.nested.UUID).toBe("not-a-plugin-identity");
  });

  it("preserves exact numeric tokens in migrated manifest text", async () => {
    const directory = await fixtureDirectory();
    const input = join(directory, "numbers.streamDeckProfile");
    const output = join(directory, "numbers-migrated.streamDeckProfile");
    await writeArchive(input, [
      { data: new TextEncoder().encode(JSON.stringify(rootManifest())), name: ROOT_ENTRY },
      { data: new TextEncoder().encode(rawPageManifestText("io.github.roger6vi.ai-deck")), name: PAGE_ENTRY },
    ]);
    const inputBefore = await readFile(input);

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `ai-deck: migrated 1 action reference(s) to roger6vi.ai-deck.\nai-deck: wrote ${output}\n`,
    );
    expect(await readFile(input)).toEqual(inputBefore);

    // Raw text, never JSON.parse: a number round-trip through JS Number masks the defect.
    const pageText = rawText(await readArchive(output), PAGE_ENTRY);
    expect(pageText).toContain('"recordId":9007199254740993');
    expect(pageText).toContain('"negativeZero":-0');
    expect(pageText).toContain('"exponent":1.5e3');
    expect(pageText).toContain('"inner":-2.50e-1');
    expect(pageText).toContain('1E+2');
    expect(pageText).toContain('0.10');
    expect(pageText).toContain(`"UUID":"${CURRENT_ACTION_UUID}"`);
    expect(pageText).not.toContain('"io.github.roger6vi.ai-deck.session-slot"');
  });

  it("leaves an assets/manifest.json entry byte-identical even with Controllers-shaped content", async () => {
    const directory = await fixtureDirectory();
    const input = join(directory, "asset-manifest.streamDeckProfile");
    const output = join(directory, "asset-manifest-migrated.streamDeckProfile");
    const assetManifestBytes = new TextEncoder().encode(
      '{\n  "Controllers": [ { "Actions": { "0,0": { "ActionID": "asset", "UUID": "io.github.roger6vi.ai-deck.session-slot" } } } ],\n  "recordId": 9007199254740993\n}',
    );
    await writeArchive(input, [
      { data: new TextEncoder().encode(JSON.stringify(rootManifest())), name: ROOT_ENTRY },
      { data: new TextEncoder().encode(JSON.stringify(pageManifest("com.gentleman.ai-deck"))), name: PAGE_ENTRY },
      { data: assetManifestBytes, name: ASSET_MANIFEST_ENTRY },
    ]);
    const inputBefore = await readFile(input);

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `ai-deck: migrated 2 action reference(s) to roger6vi.ai-deck.\nai-deck: wrote ${output}\n`,
    );
    expect(await readFile(input)).toEqual(inputBefore);

    const entries = await readArchive(output);
    expect(entries.get(ASSET_MANIFEST_ENTRY)).toEqual(assetManifestBytes);
    expect(rawText(entries, PAGE_ENTRY)).toContain(`"UUID":"${CURRENT_ACTION_UUID}"`);
  });

  it("leaves an already-current profile explicit and byte-equivalent in content", async () => {
    const directory = await fixtureDirectory();
    const input = join(directory, "current.streamDeckProfile");
    const output = join(directory, "current-copy.streamDeckProfile");
    await writeProfile(input, CURRENT_PLUGIN_UUID);

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/already current/i);
    const before = await readArchive(input);
    const after = await readArchive(output);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [name, bytes] of before) expect(after.get(name)).toEqual(bytes);
  });

  it("rejects the same input and output path without modifying the input", async () => {
    const directory = await fixtureDirectory();
    const input = join(directory, "same.streamDeckProfile");
    await writeProfile(input, "com.gentleman.ai-deck");
    const before = await readFile(input);

    const result = await runCli(["--input", input, "--output", input]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/same path/i);
    expect(await readFile(input)).toEqual(before);
  });

  it("rejects an existing output file and preserves both files", async () => {
    const directory = await fixtureDirectory();
    const input = join(directory, "source.streamDeckProfile");
    const output = join(directory, "taken.streamDeckProfile");
    await writeProfile(input, "io.github.roger6vi.ai-deck");
    const sentinel = new TextEncoder().encode("existing destination");
    await writeFile(output, sentinel);
    const inputBefore = await readFile(input);

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/i);
    expect(await readFile(input)).toEqual(inputBefore);
    expect(await readFile(output)).toEqual(Buffer.from(sentinel));
  });

  it.each([
    ["missing input", async (directory: string) => [join(directory, "absent.streamDeckProfile")]],
    [
      "input that is not a profile archive",
      async (directory: string) => {
        const input = join(directory, "not-a-zip.streamDeckProfile");
        await writeFile(input, "not a zip");
        return [input];
      },
    ],
    [
      "archive without a profile manifest",
      async (directory: string) => {
        const input = join(directory, "unrelated.streamDeckProfile");
        await writeArchive(input, [
          { data: new TextEncoder().encode("{}"), name: "unrelated/manifest.json" },
        ]);
        return [input];
      },
    ],
    [
      "path without the exported profile extension",
      async (directory: string) => {
        const input = join(directory, "profile.zip");
        await writeProfile(input, "com.gentleman.ai-deck");
        return [input];
      },
    ],
  ])("rejects %s without writing an output", async (_label, prepare) => {
    const directory = await fixtureDirectory();
    const [input] = await prepare(directory);
    if (input === undefined) throw new Error("Fixture must produce an input path.");
    const output = join(directory, "output.streamDeckProfile");

    const result = await runCli(["--input", input, "--output", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toBe("");
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("documents usage with --help and rejects missing arguments", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--input");
    expect(help.stdout).toContain("--output");

    const missing = await runCli([]);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("--input");
  });
});
