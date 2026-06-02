import { describe, expect, it, vi } from "vitest";
import { CalleClient, CalleAPIError, CalleTimeoutError } from "../src/index";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

const completedCall = {
  id: "call_123",
  status: "completed",
  task: "Call.",
  recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
  structured_result: { can_attend: "yes" },
  result_validation: { valid: true },
  summary: "Done.",
  transcript: null,
  metadata: { workflow_run_id: "wf_123" },
  failure_code: null,
  failure_message: null,
  created_at: "2026-05-31T00:00:00Z",
  completed_at: "2026-05-31T00:01:00Z"
};

describe("CalleClient calls", () => {
  it("creates calls with auth and idempotency headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer key_test");
      expect(request.headers.get("idempotency-key")).toBe("wf_123");
      expect(await request.json()).toMatchObject({
        task: "Call.",
        result_schema: { type: "object", properties: {} },
        webhook_url: "https://example.com/webhook"
      });
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.example.com", fetch: fetchMock });

    const call = await client.calls.create(
      {
        task: "Call.",
        recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
        resultSchema: { type: "object", properties: {} },
        webhookUrl: "https://example.com/webhook"
      },
      { idempotencyKey: "wf_123" }
    );

    expect(call.id).toBe("call_123");
    expect(call.structuredResult).toEqual({ can_attend: "yes" });
  });

  it("maps API errors into CalleAPIError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "idempotency_conflict", message: "Conflict.", details: { key: "wf_123" } } },
        { status: 409 }
      )
    );
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.example.com", fetch: fetchMock });

    await expect(
      client.calls.create({
        task: "Call.",
        recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
        resultSchema: { type: "object", properties: {} }
      })
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409
    } satisfies Partial<CalleAPIError>);
  });

  it("waits until a call reaches completed", async () => {
    const queued = { ...completedCall, status: "queued", structured_result: null, completed_at: null };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(queued))
      .mockResolvedValueOnce(jsonResponse(completedCall));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.example.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns failed terminal calls instead of throwing", async () => {
    const failed = {
      ...completedCall,
      status: "failed",
      failure_code: "no_answer",
      completed_at: "2026-05-31T00:01:00Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(failed));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.example.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("failed");
    expect(call.failureCode).toBe("no_answer");
  });

  it("raises CalleTimeoutError when wait timeout is reached", async () => {
    const queued = { ...completedCall, status: "queued", structured_result: null, completed_at: null };
    const fetchMock = vi.fn(async () => jsonResponse(queued));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.example.com", fetch: fetchMock });

    await expect(client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 2 })).rejects.toBeInstanceOf(
      CalleTimeoutError
    );
  });
});
