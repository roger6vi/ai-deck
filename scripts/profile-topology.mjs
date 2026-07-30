import { validateProfileArchive } from "./profile-envelope.mjs";

const ROOT_ENTRY = "8E61C791-8708-42EA-9891-1554B6F0B5B8.sdProfile/manifest.json";
const PAGE_ENTRY = "8E61C791-8708-42EA-9891-1554B6F0B5B8.sdProfile/Profiles/TCT463B30T74L6S1LPIEFS6ST4Z/manifest.json";
const ENTRY_NAMES = Object.freeze([ROOT_ENTRY, PAGE_ENTRY]);
const PAGE_ID = "eb3a430d-6307-4e4a-9b81-ae64e7f0dce9";
const SLOT_UUID = "com.gentleman.ai-deck.session-slot";
const COORDINATES = Object.freeze(["0,0", "1,0", "2,0", "3,0", "4,0"]);
const ACTION_IDS = Object.freeze([
  "055a7ebd-275b-5671-883b-d18d04fe3672",
  "83b41a68-b645-5d6f-8a12-fa96ad93b45f",
  "76e9ed66-e090-518b-8913-0176576205f7",
  "de50ad89-b5eb-5368-8d58-42f2801c0544",
  "c0cf6f65-1b8d-511c-8b11-99327bc6a190",
]);
const TITLES = Object.freeze([
  "Reserved Slot 1",
  "Reserved Slot 2",
  "Reserved Slot 3",
  "Reserved Slot 4",
  "Reserved Slot 5",
]);
const SLOT_KEYS = Object.freeze(["ActionID", "LinkedTitle", "Name", "Settings", "State", "States", "UUID"]);
const STATE_KEYS = Object.freeze([
  "FontFamily",
  "FontSize",
  "FontStyle",
  "FontUnderline",
  "OutlineThickness",
  "ShowTitle",
  "Title",
  "TitleAlignment",
  "TitleColor",
]);
const ROOT_CONTRACT = Object.freeze({ Device: Object.freeze({ Model: "20GAA9901", UUID: "" }), Name: "Local Agent Status", Pages: Object.freeze({ Current: PAGE_ID, Default: PAGE_ID, Pages: Object.freeze([PAGE_ID]) }), Version: "2.0" });
const PAGE_CONTRACT = Object.freeze({
  Controllers: Object.freeze([Object.freeze({ Actions: Object.freeze({
    "0,0": Object.freeze({ ActionID: "055a7ebd-275b-5671-883b-d18d04fe3672", LinkedTitle: true, Name: "Reserved Session Slot", Settings: Object.freeze({}), State: 0, States: Object.freeze([Object.freeze({ FontFamily: "", FontSize: 9, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: true, Title: "Reserved Slot 1", TitleAlignment: "middle", TitleColor: "#ffffff" })]), UUID: SLOT_UUID }),
    "1,0": Object.freeze({ ActionID: "83b41a68-b645-5d6f-8a12-fa96ad93b45f", LinkedTitle: true, Name: "Reserved Session Slot", Settings: Object.freeze({}), State: 0, States: Object.freeze([Object.freeze({ FontFamily: "", FontSize: 9, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: true, Title: "Reserved Slot 2", TitleAlignment: "middle", TitleColor: "#ffffff" })]), UUID: SLOT_UUID }),
    "2,0": Object.freeze({ ActionID: "76e9ed66-e090-518b-8913-0176576205f7", LinkedTitle: true, Name: "Reserved Session Slot", Settings: Object.freeze({}), State: 0, States: Object.freeze([Object.freeze({ FontFamily: "", FontSize: 9, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: true, Title: "Reserved Slot 3", TitleAlignment: "middle", TitleColor: "#ffffff" })]), UUID: SLOT_UUID }),
    "3,0": Object.freeze({ ActionID: "de50ad89-b5eb-5368-8d58-42f2801c0544", LinkedTitle: true, Name: "Reserved Session Slot", Settings: Object.freeze({}), State: 0, States: Object.freeze([Object.freeze({ FontFamily: "", FontSize: 9, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: true, Title: "Reserved Slot 4", TitleAlignment: "middle", TitleColor: "#ffffff" })]), UUID: SLOT_UUID }),
    "4,0": Object.freeze({ ActionID: "c0cf6f65-1b8d-511c-8b11-99327bc6a190", LinkedTitle: true, Name: "Reserved Session Slot", Settings: Object.freeze({}), State: 0, States: Object.freeze([Object.freeze({ FontFamily: "", FontSize: 9, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: true, Title: "Reserved Slot 5", TitleAlignment: "middle", TitleColor: "#ffffff" })]), UUID: SLOT_UUID }),
  }), Type: "Keypad" })]), Icon: "", Name: "" });
const EXPECTED_JSON = Object.freeze({ [ROOT_ENTRY]: JSON.stringify(ROOT_CONTRACT), [PAGE_ENTRY]: JSON.stringify(PAGE_CONTRACT) });

function topologyError() {
  return new Error("Profile topology does not match the canonical contract.");
}

function canonicalContractError() {
  return new Error("Profile JSON does not match the canonical contract.");
}

function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw topologyError();
  return value;
}

function exactKeys(value, keys) {
  const result = object(value);
  const actual = Object.keys(result).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw topologyError();
  return result;
}

function equal(value, expected) {
  if (value !== expected) throw topologyError();
}

function validateRoot(root) {
  const value = exactKeys(root, ["Device", "Name", "Pages", "Version"]);
  const device = exactKeys(value.Device, ["Model", "UUID"]);
  const pages = exactKeys(value.Pages, ["Current", "Default", "Pages"]);
  equal(device.Model, "20GAA9901");
  equal(device.UUID, "");
  equal(value.Name, "Local Agent Status");
  equal(value.Version, "2.0");
  equal(pages.Current, PAGE_ID);
  equal(pages.Default, PAGE_ID);
  if (!Array.isArray(pages.Pages) || pages.Pages.length !== 1) throw topologyError();
  equal(pages.Pages[0], PAGE_ID);
}

function validateSlot(slot, index) {
  const value = exactKeys(slot, SLOT_KEYS);
  const states = value.States;
  exactKeys(value.Settings, []);
  equal(value.ActionID, ACTION_IDS[index]);
  equal(value.LinkedTitle, true);
  equal(value.Name, "Reserved Session Slot");
  equal(value.State, 0);
  equal(value.UUID, SLOT_UUID);
  if (!Array.isArray(states) || states.length !== 1) throw topologyError();
  const state = exactKeys(states[0], STATE_KEYS);
  equal(state.FontFamily, "");
  equal(state.FontSize, 9);
  equal(state.FontStyle, "");
  equal(state.FontUnderline, false);
  equal(state.OutlineThickness, 2);
  equal(state.ShowTitle, true);
  equal(state.Title, TITLES[index]);
  equal(state.TitleAlignment, "middle");
  equal(state.TitleColor, "#ffffff");
}

function validatePage(page) {
  const value = exactKeys(page, ["Controllers", "Icon", "Name"]);
  equal(value.Icon, "");
  equal(value.Name, "");
  if (!Array.isArray(value.Controllers) || value.Controllers.length !== 1) throw topologyError();
  const controller = exactKeys(value.Controllers[0], ["Actions", "Type"]);
  equal(controller.Type, "Keypad");
  const actions = exactKeys(controller.Actions, COORDINATES);
  COORDINATES.forEach((coordinate, index) => validateSlot(actions[coordinate], index));
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length !== ENTRY_NAMES.length) throw topologyError();
  const names = entries.map((entry) => entry.filename);
  if (entries.some((entry) => entry.directory) || new Set(names).size !== ENTRY_NAMES.length) throw topologyError();
  if (names.some((name) => !ENTRY_NAMES.includes(name))) throw topologyError();
  return Object.fromEntries(entries.map((entry) => [entry.filename, entry]));
}

/** Validates the canonical envelope before independently confirming its strict ZIP topology. */
export async function validateCanonicalProfileTopology(bytes) {
  await validateProfileArchive(bytes);
  const { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { strictness: "strict" });
  let primaryError;
  try {
    const entries = validateEntries(await reader.getEntries({ strictness: "strict" }));
    const [rootBytes, pageBytes] = await Promise.all(
      ENTRY_NAMES.map((name) => entries[name].getData(new Uint8ArrayWriter(), { strictness: "strict" })),
    );
    const rootText = new TextDecoder().decode(rootBytes);
    const pageText = new TextDecoder().decode(pageBytes);
    if (rootText !== EXPECTED_JSON[ROOT_ENTRY] || pageText !== EXPECTED_JSON[PAGE_ENTRY]) throw canonicalContractError();
    validateRoot(JSON.parse(rootText));
    validatePage(JSON.parse(pageText));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await reader.close();
    } catch (error) {
      if (!primaryError) throw error;
    }
  }
}
