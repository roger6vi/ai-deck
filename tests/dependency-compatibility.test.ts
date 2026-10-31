import streamDeck from "@elgato/streamdeck";
import { JsonRpcRequest, JsonRpcResponse } from "@elgato/utils/rpc";
import { describe, expect, it } from "vitest";

describe("Stream Deck dependency compatibility", () => {
  it("preserves SDK loading and valid/invalid RPC validation across the Zod security update", () => {
    expect(typeof streamDeck.connect).toBe("function");
    expect(typeof streamDeck.actions.registerAction).toBe("function");
    const request = { jsonrpc: "2.0", method: "compatibility", id: "1", params: { value: "ok" } };
    const response = { jsonrpc: "2.0", id: "1", result: { value: "ok" } };
    expect(JsonRpcRequest.safeParse(request)).toMatchObject({ success: true, data: request });
    expect(JsonRpcResponse.safeParse(response)).toMatchObject({ success: true, data: response });
    expect(JsonRpcRequest.safeParse({ ...request, method: 42 }).success).toBe(false);
    expect(JsonRpcResponse.safeParse({ ...response, jsonrpc: "1.0" }).success).toBe(false);
  });
});
