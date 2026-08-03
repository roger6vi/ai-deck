import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const PI_PATH = "com.gentleman.ai-deck.sdPlugin/ui/session-slot.html";

describe("session slot property inspector page", () => {
  it("is a self-contained page with a session dropdown", async () => {
    const html = await readFile(PI_PATH, "utf8");
    expect(html).toContain('<select id="session"');
    expect(html).not.toMatch(/src="https?:|href="https?:/);
  });

  it("registers through the global connectElgatoStreamDeckSocket contract", async () => {
    const html = await readFile(PI_PATH, "utf8");
    expect(html).toContain("connectElgatoStreamDeckSocket");
    expect(html).toContain("new WebSocket(");
    expect(html).toContain("propertyInspectorUUID");
  });

  it("renders sessions payloads and sends set-slot-session selections", async () => {
    const html = await readFile(PI_PATH, "utf8");
    expect(html).toContain('"sendToPropertyInspector"');
    expect(html).toContain('"sessions"');
    expect(html).toContain('"sendToPlugin"');
    expect(html).toContain('"set-slot-session"');
  });
});
