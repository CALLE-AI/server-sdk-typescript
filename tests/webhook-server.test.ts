import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

const state = vi.hoisted(() => ({ listener: undefined as RequestListener | undefined }));

vi.mock("node:http", () => ({
  createServer: vi.fn((listener: RequestListener) => {
    state.listener = listener;
    return { listen: vi.fn() };
  })
}));

process.env.CALLE_WEBHOOK_MAX_BODY_BYTES = "8";
await import("../examples/webhook-server.js");
delete process.env.CALLE_WEBHOOK_MAX_BODY_BYTES;

function response(destroyed = false): ServerResponse {
  return {
    destroyed,
    writeHead: vi.fn(),
    end: vi.fn()
  } as unknown as ServerResponse;
}

describe("webhook server example", () => {
  it("bounds request bodies and handles aborted streams", async () => {
    const listener = state.listener;
    expect(listener).toBeDefined();

    const oversizedRequest = Object.assign(
      Readable.from([Buffer.alloc(9)]),
      {
        method: "POST",
        url: "/calle/webhook",
        headers: { "call-e-event-id": "evt_large" }
      }
    ) as IncomingMessage;
    const oversizedResponse = response();

    await listener!(oversizedRequest, oversizedResponse);

    expect(oversizedResponse.writeHead).toHaveBeenCalledWith(413, {
      "content-type": "application/json"
    });
    expect(oversizedResponse.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "payload_too_large" })
    );

    const abortedRequest = {
      method: "POST",
      url: "/calle/webhook",
      headers: { "call-e-event-id": "evt_abort" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("{");
        throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
      }
    } as unknown as IncomingMessage;
    const abortedResponse = response(true);

    await listener!(abortedRequest, abortedResponse);

    expect(abortedResponse.writeHead).not.toHaveBeenCalled();
    expect(abortedResponse.end).not.toHaveBeenCalled();
  });
});
