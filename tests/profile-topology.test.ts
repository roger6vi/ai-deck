import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_PATH = new URL(
  "../com.gentleman.ai-deck.sdPlugin/Profiles/Local%20Agent%20Status.streamDeckProfile",
  import.meta.url,
);
const TOPOLOGY_MODULE = new URL("../scripts/profile-topology.mjs", import.meta.url).href;
const ENVELOPE_MODULE = new URL("../scripts/profile-envelope.mjs", import.meta.url).href;
const ZIP_MODULE = "@zip.js/zip.js";

interface ArchiveEntry {
  contents: string;
  directory?: boolean;
  filename: string;
  getData: ReturnType<typeof vi.fn>;
}

interface ArchiveReader {
  close: ReturnType<typeof vi.fn>;
  getEntries: ReturnType<typeof vi.fn>;
}

interface MockTopology {
  calls: string[];
  envelope: ReturnType<typeof vi.fn>;
  reader: ArchiveReader;
  uint8ArrayReader: ReturnType<typeof vi.fn>;
  zipReader: ReturnType<typeof vi.fn>;
  validate(bytes: Uint8Array): Promise<void>;
}

function entry(filename: string, contents: string, directory = false): ArchiveEntry {
  return {
    contents,
    directory,
    filename,
    getData: vi.fn().mockResolvedValue(new TextEncoder().encode(contents)),
  };
}

async function canonicalEntries(): Promise<ArchiveEntry[]> {
  const zip = await vi.importActual<typeof import("@zip.js/zip.js")>(ZIP_MODULE);
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(await readFile(PROFILE_PATH)));
  try {
    return await Promise.all(
      (await reader.getEntries()).map(async (archiveEntry) =>
        "getData" in archiveEntry
          ? entry(
              archiveEntry.filename,
              new TextDecoder().decode(await archiveEntry.getData(new zip.Uint8ArrayWriter(), { strictness: "strict" })),
              archiveEntry.directory,
            )
          : (() => { throw new Error("Canonical profile contains a directory entry."); })(),
      ),
    );
  } finally {
    await reader.close();
  }
}

async function mockTopology(entries: ArchiveEntry[], envelopeError?: Error, mockEnvelope = true): Promise<MockTopology> {
  const calls: string[] = [];
  const reader: ArchiveReader = {
    close: vi.fn().mockResolvedValue(undefined),
    getEntries: vi.fn().mockResolvedValue(entries),
  };
  const envelope = vi.fn().mockImplementation(async () => {
    calls.push("envelope");
    if (envelopeError) throw envelopeError;
  });
  const zipReader = vi.fn(function () {
    calls.push("reader");
    return reader;
  });
  const uint8ArrayReader = vi.fn();

  if (mockEnvelope) vi.doMock(ENVELOPE_MODULE, () => ({ validateProfileArchive: envelope }));
  vi.doMock(ZIP_MODULE, () => ({
    Uint8ArrayReader: uint8ArrayReader,
    Uint8ArrayWriter: vi.fn(),
    ZipReader: zipReader,
  }));
  const { validateCanonicalProfileTopology: validate } = await import(TOPOLOGY_MODULE);
  return { calls, envelope, reader, uint8ArrayReader, validate, zipReader };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock(ENVELOPE_MODULE);
  vi.doUnmock(ZIP_MODULE);
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("canonical profile topology", () => {
  it("accepts the committed canonical archive", async () => {
    const { validateCanonicalProfileTopology } = await import(TOPOLOGY_MODULE);

    await expect(validateCanonicalProfileTopology(await readFile(PROFILE_PATH))).resolves.toBeUndefined();
  });

  it("runs the canonical envelope before constructing a memory ZipReader", async () => {
    const valid = await canonicalEntries();
    const mocked = await mockTopology(valid);

    await mocked.validate(new Uint8Array([1]));
    expect(mocked.calls).toEqual(["envelope", "reader"]);
    expect(mocked.zipReader).toHaveBeenCalledTimes(1);
  });

  it("rejects a one-byte canonical mutation before any parser call", async () => {
    const mutated = new Uint8Array(await readFile(PROFILE_PATH));
    mutated[0] = (mutated[0] ?? 0) ^ 0xff;
    const mocked = await mockTopology([], undefined, false);

    await expect(mocked.validate(mutated)).rejects.toThrow("SHA-256");
    expect(mocked.zipReader).not.toHaveBeenCalled();
    expect(mocked.reader.close).not.toHaveBeenCalled();
  });

  it("uses strict zip.js checks at every supported reader layer", async () => {
    const valid = await canonicalEntries();
    const mocked = await mockTopology(valid);

    await mocked.validate(new Uint8Array([1]));
    expect(mocked.zipReader).toHaveBeenCalledWith(expect.anything(), { strictness: "strict" });
    expect(mocked.reader.getEntries).toHaveBeenCalledWith({ strictness: "strict" });
    for (const archiveEntry of valid) {
      expect(archiveEntry.getData).toHaveBeenCalledWith(expect.anything(), { strictness: "strict" });
    }
  });

  it.each([
    ["root", 0, (contents: string) => contents.replace('"Name":"Local Agent Status"', '"Name":"Local Agent Status","Name":"Local Agent Status"')],
    ["page controller", 1, (contents: string) => contents.replace('"Controllers":', '"Controllers":[],"Controllers":')],
  ])("rejects duplicate %s JSON keys before parsing", async (_name, index, alter) => {
    const entries = await canonicalEntries();
    const archiveEntry = entries[index]!;
    archiveEntry.getData.mockResolvedValue(new TextEncoder().encode(alter(archiveEntry.contents)));
    const mocked = await mockTopology(entries);
    const parse = vi.spyOn(JSON, "parse");

    await expect(mocked.validate(new Uint8Array([1]))).rejects.toThrow("canonical contract");
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["unexpected", (entries: ArchiveEntry[]) => [...entries, entry("extra.json", "{}")] ],
    ["missing", (entries: ArchiveEntry[]) => entries.slice(0, 1)],
    ["duplicate", (entries: ArchiveEntry[]) => [entries[0]!, { ...entries[0]! }]],
    ["directory", (entries: ArchiveEntry[]) => [{ ...entries[0]!, directory: true }, entries[1]!]],
  ])("rejects %s archive entries", async (_name, alter) => {
    const mocked = await mockTopology(alter(await canonicalEntries()));

    await expect(mocked.validate(new Uint8Array([1]))).rejects.toThrow("topology");
    expect(mocked.reader.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed JSON", "canonical contract", (entries: ArchiveEntry[]) => { entries[0]!.getData.mockResolvedValue(new TextEncoder().encode("{")); }],
    ["root metadata", "canonical contract", (entries: ArchiveEntry[]) => { entries[0]!.getData.mockResolvedValue(new TextEncoder().encode("{}")); }],
    ["page metadata", "canonical contract", (entries: ArchiveEntry[]) => { entries[1]!.getData.mockResolvedValue(new TextEncoder().encode("{}")); }],
    ["controller", "canonical contract", (entries: ArchiveEntry[]) => { entries[1]!.getData.mockResolvedValue(new TextEncoder().encode('{"Controllers":[]}')); }],
    ["action", "canonical contract", (entries: ArchiveEntry[]) => { entries[1]!.getData.mockResolvedValue(new TextEncoder().encode('{"Controllers":[{"Actions":{},"Type":"Keypad"}],"Icon":"","Name":""}')); }],
    ["complete slot fields", "canonical contract", (entries: ArchiveEntry[]) => { entries[1]!.getData.mockResolvedValue(new TextEncoder().encode('{"Controllers":[{"Actions":{"0,0":{}},"Type":"Keypad"}],"Icon":"","Name":""}')); }],
  ])("rejects invalid %s contracts and preserves their errors over close failures", async (_name, message, alter) => {
    const entries = await canonicalEntries();
    alter(entries);
    const mocked = await mockTopology(entries);
    mocked.reader.close.mockRejectedValue(new Error("close failure"));

    await expect(mocked.validate(new Uint8Array([1]))).rejects.toThrow(message);
    expect(mocked.reader.close).toHaveBeenCalledTimes(1);
  });

  it("closes after getEntries and getData failures without masking their errors", async () => {
    const getEntries = await mockTopology([]);
    getEntries.reader.getEntries.mockRejectedValue(new Error("entries failure"));
    getEntries.reader.close.mockRejectedValue(new Error("close failure"));
    await expect(getEntries.validate(new Uint8Array([1]))).rejects.toThrow("entries failure");
    expect(getEntries.reader.close).toHaveBeenCalledTimes(1);

    const entries = await canonicalEntries();
    entries[0]!.getData.mockRejectedValue(new Error("data failure"));
    const getData = await mockTopology(entries);
    getData.reader.close.mockRejectedValue(new Error("close failure"));
    await expect(getData.validate(new Uint8Array([1]))).rejects.toThrow("data failure");
    expect(getData.reader.close).toHaveBeenCalledTimes(1);
  });

  it("propagates a close failure only after otherwise successful validation", async () => {
    const mocked = await mockTopology(await canonicalEntries());
    mocked.reader.close.mockRejectedValue(new Error("close failure"));

    await expect(mocked.validate(new Uint8Array([1]))).rejects.toThrow("close failure");
  });
});
