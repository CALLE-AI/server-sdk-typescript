import { describe, expect, it, vi } from "vitest";
import { CalleClient, CalleAPIError, CalleTimeoutError } from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

const completedCall = {
  id: "call_123",
  object: "call",
  status: "completed",
  task: "Call.",
  phone: "+14155550100", region: "US", locale: "en-US", scheduled_at: null,
  result: { completed_count: 1 }, error: null,
  metadata: { workflow_run_id: "wf_123" },
  created_at: "2026-05-31T00:00:00Z",
  completed_at: "2026-05-31T00:01:00Z"
};

describe("CalleClient calls", () => {
  it("uses the production API base URL by default", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://api.heycall-e.com/v2/calls");
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await client.calls.create({
      task: "Call.",
      phone: "+14155550100", region: "US", locale: "en-US",
      resultSchema: { type: "object", additionalProperties: false, properties: {} }
    }, { idempotencyKey: "wf_123" });
  });

  it("creates calls with auth, idempotency headers, and structured result schemas", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer key_test");
      expect(request.headers.get("idempotency-key")).toBe("wf_123");
      expect(await request.json()).toMatchObject({
        task: "Call.",
        phone: "+14155550100", region: "US", locale: "en-US",
        result_schema: { type: "object", additionalProperties: false, properties: { completed_count: { type: "integer" } } },
        webhook_url: "https://example.com/webhook"
      });
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.create(
      {
        task: "Call.",
        phone: "+14155550100", region: "US", locale: "en-US",
        resultSchema: { type: "object", additionalProperties: false, properties: { completed_count: { type: "integer" } } },
        webhookUrl: "https://example.com/webhook"
      },
      { idempotencyKey: "wf_123" }
    );

    expect(call.id).toBe("call_123");
    expect(call.result).toEqual({ completed_count: 1 });
    expect(call.error).toBeNull();
    expect("structuredResult" in call).toBe(false);
  });

  it("rejects an empty idempotency key before making a request", async () => {
    const fetchMock = vi.fn();
    const client = new CalleClient({ apiKey: "test", fetch: fetchMock });
    await expect(client.calls.create({ task: "Call.", phone: "+14155550100", region: "US", locale: "en-US", resultSchema: { type: "object", additionalProperties: false, properties: {} } }, { idempotencyKey: " " })).rejects.toThrow("idempotencyKey");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels through the v2 endpoint and preserves result errors", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.heycall-e.com/v2/calls/call_123/cancel");
      return jsonResponse({ ...completedCall, status: "canceled", result: null,
        error: { code: "canceled", message: "Canceled.", detail_code: null } });
    });
    const call = await new CalleClient({ apiKey: "test", fetch: fetchMock }).calls.cancel("call_123");
    expect(call.error?.code).toBe("canceled");
    expect(call.error?.detailCode).toBeNull();
  });

  it("maps API errors into CalleAPIError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "idempotency_conflict", message: "Conflict.", details: { key: "wf_123" } } },
        { status: 409 }
      )
    );
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(
      client.calls.create({
        task: "Call.",
        phone: "+14155550100", region: "US", locale: "en-US",
        resultSchema: { type: "object", additionalProperties: false, properties: {} }
      }, { idempotencyKey: "wf_123" })
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409
    } satisfies Partial<CalleAPIError>);
  });

  it("waits through completed execution until a result is persisted", async () => {
    const queued = { ...completedCall, status: "queued", result: null, completed_at: null };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(queued))
      .mockResolvedValueOnce(jsonResponse({ ...completedCall, result: null }))
      .mockResolvedValueOnce(jsonResponse(completedCall));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns failed terminal calls instead of throwing", async () => {
    const failed = {
      ...completedCall,
      status: "failed",
      result: null, error: { code: "no_answer", message: "No answer.", detail_code: "provider_no_answer" },
      completed_at: "2026-05-31T00:01:00Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(failed));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("failed");
    expect(call.error?.code).toBe("no_answer");
  });

  it("treats an empty result as ready", async () => {
    const client = new CalleClient({ apiKey: "test", fetch: async () => jsonResponse({ ...completedCall, result: {} }) });
    expect((await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 100 })).result).toEqual({});
  });

  it("raises CalleTimeoutError when wait timeout is reached", async () => {
    const queued = { ...completedCall, status: "queued", result: null, completed_at: null };
    const fetchMock = vi.fn(async () => jsonResponse(queued));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 2 })).rejects.toBeInstanceOf(
      CalleTimeoutError
    );
  });
});
