import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerPiAdapter } from "../../pi-extension/ai-deck";
import { parseAdapterEmitArgs } from "../../src/cli/adapter-emit";
import { createSessionState, deriveSlotColor, reduceSessionState } from "../../src/core/reducer";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));

type Handler = (event?: { aborted?: boolean }) => void | Promise<void>;
function load(paneId: string | undefined = "%4") {
  const handlers = new Map<string, Handler>();
  registerPiAdapter({ on: (name, handler) => { handlers.set(name, handler); } }, {
    TMUX_PANE: paneId,
    AI_DECK_PLUGIN_ROOT: "/fixture/ai-deck.sdPlugin",
    AI_DECK_NODE: "/fixture/node",
  });
  return handlers;
}

beforeEach(() => {
  execFile.mockReset().mockImplementation((_, __, ___, callback) => callback(null, "$2\n"));
});

describe("Gentle Shell extension", () => {
  it("sends only pane metadata for start and final settlement, with a stable identity", async () => {
    const handlers = load();
    expect([...handlers.keys()]).toEqual(["agent_start", "agent_settled"]);
    await handlers.get("agent_start")?.();
    await handlers.get("agent_settled")?.({ aborted: false });
    const emissions = execFile.mock.calls.filter(([command]) => command === "/fixture/node");
    expect(emissions).toHaveLength(2);
    const events = emissions.map(([, [entry, ...argv], options], index) => {
      expect(entry).toBe("/fixture/ai-deck.sdPlugin/bin/adapter-emit.js");
      expect(options.env.AI_DECK_PLUGIN_ROOT).toBe("/fixture/ai-deck.sdPlugin");
      expect(argv).toEqual([
        "--source", "pi", "--session-id", expect.any(String),
        "--lifecycle", index === 0 ? "started" : "completed",
        "--pane-id", "%4", "--session", "$2",
        "--timestamp", expect.stringMatching(/^\d+$/), "--sequence", String(index + 1),
      ]);
      const result = parseAdapterEmitArgs(argv, { now: () => 0 });
      expect(result.kind).toBe("event");
      if (result.kind !== "event") throw new Error("Pi event rejected by emitter");
      return result.event;
    });
    const [started, settled] = events;
    if (!started || !settled) throw new Error("Missing lifecycle events");
    expect(started.sessionId).toBe(settled.sessionId);

    const idle = reduceSessionState(createSessionState(), { kind: "pane-discovery", panes: [{
      sessionId: "00000000-0000-4000-8000-000000000004",
      target: { ...started.target, tmuxWindow: "@4" },
    }] });
    const running = reduceSessionState(idle, { kind: "event", event: started });
    const done = reduceSessionState(running, { kind: "event", event: settled });
    const read = reduceSessionState(done, { kind: "physical-key-down", slotIndex: 0 });
    expect([idle, running, done, read].map((state) => deriveSlotColor(state.slots[0], settled.timestamp)))
      .toEqual(["green", "amber", "blue", "green"]);
    for (const state of [running, done, read]) {
      expect(state.slots.filter((slot) => slot.sessionId)).toHaveLength(1);
      expect(state.slots[0]?.assignmentId).toBe(idle.slots[0]?.assignmentId);
    }
  });

  it("does not emit outside tmux and tolerates tmux or emitter failures", async () => {
    const outside = load("");
    expect(outside.size).toBe(0);
    const handlers = load();
    execFile.mockImplementationOnce((_, __, ___, callback) => callback(new Error("tmux unavailable")));
    await expect(handlers.get("agent_start")?.()).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
    execFile.mockImplementationOnce((_, __, ___, callback) => callback(null, "$2\n"));
    execFile.mockImplementationOnce((_, __, ___, callback) => callback(new Error("emitter unavailable")));
    await expect(handlers.get("agent_settled")?.()).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(3);
  });
});
