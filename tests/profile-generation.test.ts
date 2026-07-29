import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { buildProfile } from "../scripts/build-profile.mjs";
import {
  PROFILE_FILE,
  SESSION_SLOT_ACTION_UUID,
  readProfileArchive,
} from "../scripts/profile-contract.mjs";
import { SESSION_SLOT_ACTION_UUID as runtimeActionUuid } from "../src/actions/session-slot.constants";

interface PluginAction {
  UUID: string;
}

interface PluginProfile {
  AutoInstall: boolean;
  DeviceType: number;
  Name: string;
}

interface PluginManifest {
  Actions: PluginAction[];
  Profiles: PluginProfile[];
}

interface ProfileDevice {
  Model: string;
  UUID: string;
}

interface ProfilePages {
  Current: string;
  Default: string;
  Pages: string[];
}

interface ProfileRoot {
  Device: ProfileDevice;
  Name: string;
  Pages: ProfilePages;
  Version: string;
}

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = resolve(PROJECT_ROOT, "com.gentleman.ai-deck.sdPlugin/manifest.json");
const TEMPORARY_PROFILE_NAME = "Local Agent Status.streamDeckProfile";
const EXPECTED_ARCHIVE_PATHS = [
  "8E61C791-8708-42EA-9891-1554B6F0B5B8.sdProfile/manifest.json",
  "8E61C791-8708-42EA-9891-1554B6F0B5B8.sdProfile/Profiles/TCT463B30T74L6S1LPIEFS6ST4Z/manifest.json",
] as const;
const EXPECTED_ACTION_IDS = [
  "055a7ebd-275b-5671-883b-d18d04fe3672",
  "83b41a68-b645-5d6f-8a12-fa96ad93b45f",
  "76e9ed66-e090-518b-8913-0176576205f7",
  "de50ad89-b5eb-5368-8d58-42f2801c0544",
  "c0cf6f65-1b8d-511c-8b11-99327bc6a190",
] as const;
const EXPECTED_COORDINATES = ["0,0", "1,0", "2,0", "3,0", "4,0"] as const;
const temporaryDirectories: string[] = [];
const executeFile = promisify(execFile);
const PROFILE_BUILD_MODULE = new URL("../scripts/build-profile.mjs", import.meta.url).href;
const PROFILE_BUILD_PROGRAM = `import { buildProfile } from ${JSON.stringify(PROFILE_BUILD_MODULE)}; await buildProfile(process.argv[1]);`;
const EXPECTED_PAGE = {
  Controllers: [
    {
      Actions: Object.fromEntries(
        EXPECTED_COORDINATES.map((coordinate, index) => [
          coordinate,
          {
            ActionID: EXPECTED_ACTION_IDS[index],
            LinkedTitle: true,
            Name: "Reserved Session Slot",
            Settings: {},
            State: 0,
            States: [
              {
                FontFamily: "",
                FontSize: 9,
                FontStyle: "",
                FontUnderline: false,
                OutlineThickness: 2,
                ShowTitle: true,
                Title: `Reserved Slot ${index + 1}`,
                TitleAlignment: "middle",
                TitleColor: "#ffffff",
              },
            ],
            UUID: runtimeActionUuid,
          },
        ]),
      ),
      Type: "Keypad",
    },
  ],
  Icon: "",
  Name: "",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function generateIsolatedProfile(timeZone?: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "ai-deck-profile-"));
  temporaryDirectories.push(directory);
  const outputPath = join(directory, TEMPORARY_PROFILE_NAME);

  if (timeZone) {
    await executeFile(
      process.execPath,
      ["--input-type=module", "--eval", PROFILE_BUILD_PROGRAM, outputPath],
      { env: { ...process.env, TZ: timeZone } },
    );
  } else {
    await buildProfile(outputPath);
  }

  return readFile(outputPath);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("deterministic Local Agent Status profile generation", () => {
  it("registers an opt-in original-device profile aligned with the runtime action", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as PluginManifest;

    expect(manifest.Actions).toHaveLength(1);
    expect(manifest.Actions[0]?.UUID).toBe(runtimeActionUuid);
    expect(SESSION_SLOT_ACTION_UUID).toBe(runtimeActionUuid);
    expect(manifest.Profiles).toEqual([
      {
        Name: "Profiles/Local Agent Status",
        DeviceType: 0,
        Readonly: false,
        DontAutoSwitchWhenInstalled: false,
        AutoInstall: false,
      },
    ]);
    const { manifests } = await readProfileArchive(await readFile(PROFILE_FILE));
    const root = manifests[0] as ProfileRoot;
    expect(manifest.Profiles[0]?.Name).toBe(`Profiles/${root.Name}`);
    expect(PROFILE_FILE).toBe(`com.gentleman.ai-deck.sdPlugin/Profiles/${root.Name}.streamDeckProfile`);
  });

  it("writes one Keypad page with exactly five reserved row-zero actions", async () => {
    const { manifests, names } = await readProfileArchive(await readFile(PROFILE_FILE));
    const root = manifests[0] as ProfileRoot;
    const page = manifests[1];

    expect(names).toEqual(EXPECTED_ARCHIVE_PATHS);
    expect(root).toEqual({
      Device: { Model: "20GAA9901", UUID: "" },
      Name: "Local Agent Status",
      Pages: {
        Current: "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9",
        Default: "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9",
        Pages: ["eb3a430d-6307-4e4a-9b81-ae64e7f0dce9"],
      },
      Version: "2.0",
    });
    expect(page).toEqual(EXPECTED_PAGE);
  });

  it("generates three sequential isolated archives without mutating repository output", async () => {
    const before = await readFile(PROFILE_FILE);
    const generated = [
      await generateIsolatedProfile(),
      await generateIsolatedProfile(),
      await generateIsolatedProfile(),
    ];
    const after = await readFile(PROFILE_FILE);
    const hashes = generated.map(sha256);

    expect(generated[1]).toEqual(generated[0]);
    expect(generated[2]).toEqual(generated[0]);
    expect(new Set(hashes).size).toBe(1);
    expect(after).toEqual(before);
    expect(sha256(before)).toBe(hashes[0]);
  });

  it("writes identical isolated ZIP bytes in UTC and Los Angeles", async () => {
    const normal = await generateIsolatedProfile();
    const utc = await generateIsolatedProfile("UTC");
    const losAngeles = await generateIsolatedProfile("America/Los_Angeles");

    expect(sha256(utc)).toBe(sha256(normal));
    expect(sha256(losAngeles)).toBe(sha256(normal));
  });
});
