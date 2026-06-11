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
  object: "call_task",
  status: "completed",
  task: "Call.",
  recipients: [
    {
      id: "rcp_123",
      phones: ["+14155550100"],
      region: "US",
      locale: "en-US",
      status: "completed",
      structured_result: { can_attend: "yes" },
      summary: "Recipient can attend.",
      attempts: [
        {
          id: "att_123",
          phone: "+14155550100",
          status: "completed",
          started_at: "2026-05-31T00:00:10Z",
          completed_at: "2026-05-31T00:01:00Z",
          summary: "Recipient can attend.",
          transcript_turns: [{ offset_seconds: 2, speaker: "user", text: "Yes." }],
          provider_call_id: "provider_123",
          failure_code: null,
          failure_message: null
        }
      ]
    }
  ],
  structured_result: { completed_count: 1 },
  summary: "Done.",
  task_completed: true,
  completion_confidence: { score: 0.92, label: "high" },
  evidence: ["The recipient said yes."],
  metadata: { workflow_run_id: "wf_123" },
  failure_code: null,
  failure_message: null,
  created_at: "2026-05-31T00:00:00Z",
  completed_at: "2026-05-31T00:01:00Z"
};

describe("CalleClient calls", () => {
  it("uses the production API base URL by default", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://api.heycall-e.com/v1/calls");
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await client.calls.create({
      task: "Call.",
      recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
      resultSchema: { type: "object", properties: {} }
    });
  });

  it("creates calls with auth, idempotency headers, and structured result schemas", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer key_test");
      expect(request.headers.get("idempotency-key")).toBe("wf_123");
      expect(await request.json()).toMatchObject({
        task: "Call.",
        recipients: [{ phones: ["+14155550100"], region: "US", locale: "en-US" }],
        result_schema: { type: "object", properties: { completed_count: { type: "integer" } } },
        recipient_result_schema: { type: "object", properties: { can_attend: { type: "string" } } },
        webhook_url: "https://example.com/webhook"
      });
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.create(
      {
        task: "Call.",
        recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
        resultSchema: { type: "object", properties: { completed_count: { type: "integer" } } },
        recipientResultSchema: { type: "object", properties: { can_attend: { type: "string" } } },
        webhookUrl: "https://example.com/webhook"
      },
      { idempotencyKey: "wf_123" }
    );

    expect(call.id).toBe("call_123");
    expect(call.structuredResult).toEqual({ completed_count: 1 });
    expect(call.taskCompleted).toBe(true);
    expect(call.completionConfidence).toEqual({ score: 0.92, label: "high" });
    expect(call.evidence).toEqual(["The recipient said yes."]);
    expect(call.recipients[0]?.structuredResult).toEqual({ can_attend: "yes" });
    expect(call.recipients[0]?.attempts[0]?.transcriptTurns).toEqual([{ offset_seconds: 2, speaker: "user", text: "Yes." }]);
    expect("resultValidation" in call).toBe(false);
  });

  it("creates task-only calls without explicit recipients or schemas", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(await request.json()).toEqual({ task: "Call +14155550100." });
      return jsonResponse(completedCall);
    });
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.create({ task: "Call +14155550100." });

    expect(call.status).toBe("completed");
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
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

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
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("failed");
    expect(call.failureCode).toBe("no_answer");
  });

  it("raises CalleTimeoutError when wait timeout is reached", async () => {
    const queued = { ...completedCall, status: "queued", structured_result: null, completed_at: null };
    const fetchMock = vi.fn(async () => jsonResponse(queued));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 2 })).rejects.toBeInstanceOf(
      CalleTimeoutError
    );
  });
});
