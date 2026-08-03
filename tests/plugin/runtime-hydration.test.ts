import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSessionState, type SessionState } from "../../src/core/reducer";
import type { LocalAgentStatusEvent } from "../../src/core/types";
import { PLUGIN_RUNTIME_LOG_MESSAGE, startPluginRuntime } from "../../src/plugin/runtime";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-deck-hydration-"));
  await chmod(root, 0o700);
  return root;
}

interface FakeController {
  handleStatusEvent(event: LocalAgentStatusEvent, now: number): Promise<void>;
  dispose(): void;
  hydrateState?(state: SessionState): Promise<void>;
  subscribeToStateChanges?(subscriber: (state: SessionState) => void | Promise<void>): () => void;
}

describe("plugin runtime persistence wiring", () => {
  it("hydrates the controller from the persistence store before publishing the endpoint", async () => {
    const root = await temporaryRoot();
    try {
      const loaded: SessionState = createSessionState();
      const load = vi.fn(async () => loaded);
      const hydrateState = vi.fn(async () => undefined);
      const controller: FakeController = {
        handleStatusEvent: vi.fn(async () => undefined),
        dispose: vi.fn(),
        hydrateState,
        subscribeToStateChanges: vi.fn(() => () => undefined),
      };

      const publishOrder: string[] = [];
      const publishEndpoint = vi.fn(async () => { publishOrder.push("publish"); return { record: { schemaVersion: 1, address: "127.0.0.1", port: 0, token: "x".repeat(32), pid: 0 }, path: "" }; });
      hydrateState.mockImplementation(async () => { publishOrder.push("hydrate"); });

      const runtime = await startPluginRuntime({
        pluginRoot: root,
        controller,
        persistence: { load, save: vi.fn(async () => undefined) },
        publishEndpoint,
      });

      expect(load).toHaveBeenCalledTimes(1);
      expect(hydrateState).toHaveBeenCalledTimes(1);
      expect(hydrateState).toHaveBeenCalledWith(loaded);
      expect(publishOrder).toEqual(["hydrate", "publish"]);

      await runtime.stop();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("passes loaded state through persistence.reconcile before hydration when reconcile is provided", async () => {
    const root = await temporaryRoot();
    try {
      const loaded: SessionState = createSessionState();
      const reconciled: SessionState = createSessionState();
      const load = vi.fn(async () => loaded);
      const reconcile = vi.fn(async () => reconciled);
      const hydrateState = vi.fn(async () => undefined);
      const controller: FakeController = {
        handleStatusEvent: vi.fn(async () => undefined),
        dispose: vi.fn(),
        hydrateState,
        subscribeToStateChanges: vi.fn(() => () => undefined),
      };

      const runtime = await startPluginRuntime({
        pluginRoot: root,
        controller,
        persistence: { load, save: vi.fn(async () => undefined), reconcile },
      });

      expect(reconcile).toHaveBeenCalledWith(loaded);
      expect(hydrateState).toHaveBeenCalledWith(reconciled);

      await runtime.stop();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("subscribes persistence.save to controller state changes and unsubscribes on stop", async () => {
    const root = await temporaryRoot();
    try {
      const save = vi.fn(async () => undefined);
      let subscriber: ((state: SessionState) => void | Promise<void>) | undefined;
      const unsubscribe = vi.fn();
      const controller: FakeController = {
        handleStatusEvent: vi.fn(async () => undefined),
        dispose: vi.fn(),
        hydrateState: vi.fn(async () => undefined),
        subscribeToStateChanges: (fn) => { subscriber = fn; return unsubscribe; },
      };

      const runtime = await startPluginRuntime({
        pluginRoot: root,
        controller,
        persistence: { load: async () => createSessionState(), save },
      });

      expect(subscriber).toBeDefined();
      await subscriber?.(createSessionState());
      expect(save).toHaveBeenCalledTimes(1);

      await runtime.stop();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("logs and continues without hydration when persistence.load fails", async () => {
    const root = await temporaryRoot();
    try {
      const errors: string[] = [];
      const hydrateState = vi.fn(async () => undefined);
      const controller: FakeController = {
        handleStatusEvent: vi.fn(async () => undefined),
        dispose: vi.fn(),
        hydrateState,
        subscribeToStateChanges: vi.fn(() => () => undefined),
      };

      const runtime = await startPluginRuntime({
        pluginRoot: root,
        controller,
        logger: { error: (message) => errors.push(message) },
        persistence: { load: async () => { throw new Error("simulated load failure"); }, save: vi.fn(async () => undefined) },
      });

      expect(hydrateState).not.toHaveBeenCalled();
      expect(errors).toContain(PLUGIN_RUNTIME_LOG_MESSAGE.HYDRATION_FAILED);
      expect(errors.every((message) => !message.includes("simulated"))).toBe(true);

      await runtime.stop();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("operates without hydration when the controller does not implement hydrateState", async () => {
    const root = await temporaryRoot();
    try {
      const controller: FakeController = {
        handleStatusEvent: vi.fn(async () => undefined),
        dispose: vi.fn(),
      };

      const runtime = await startPluginRuntime({
        pluginRoot: root,
        controller,
        persistence: { load: vi.fn(async () => createSessionState()), save: vi.fn(async () => undefined) },
      });

      expect(controller.handleStatusEvent).not.toHaveBeenCalled();
      await runtime.stop();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
