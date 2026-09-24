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
  call_id: "billing-call-123",
  object: "call",
  status: "completed",
  call_outcome: "completed",
  result_status: "available",
  transcript: [],
  task: "Call.",
  phone: "+14155550100", region: "US", locale: "en-US",
  result: { completed_count: 1 }, error: null,
  metadata: { workflow_run_id: "wf_123" },
  created_at: "2026-05-31T00:00:00Z",
  completed_at: "2026-05-31T00:01:00Z"
};

describe("CalleClient calls", () => {
  it.each([null, "billing-call-123"])("keeps Billing callId separate from the API id: %s", async (callId) => {
    const client = new CalleClient({apiKey:"test",fetch:async(request)=>{
      expect(new URL(request.url).pathname).toBe("/v2/calls/call_123");
      return jsonResponse({...completedCall, call_id: callId});
    }});
    const call = await client.calls.get("call_123");
    expect(call.id).toBe("call_123");
    expect(call.callId).toBe(callId);
  });
  it("omits optional target hints and returns the resolved target", async () => {
    const client = new CalleClient({apiKey:"test",fetch:async(request)=>{
      const body = await request.json();
      expect(body).not.toHaveProperty("region");
      expect(body).not.toHaveProperty("locale");
      return jsonResponse(completedCall);
    }});
    const call = await client.calls.create({task:"Ask in English.",phone:"+14155550100",
      resultSchema:{type:"object",properties:{},additionalProperties:false}}, {idempotencyKey:"infer-target"});
    expect(call.region).toBe("US");
    expect(call.locale).toBe("en-US");
  });
  it("returns observed transcript turns even when the business result is unavailable", async () => {
    const transcript = [{speaker:"bot",offset_seconds:0,text:"Hello."},
      {speaker:"unknown",offset_seconds:null,text:"Unattributed words."}];
    const client = new CalleClient({apiKey:"test",fetch:async()=>jsonResponse({
      ...completedCall,result_status:"unavailable",result:null,error:null,transcript,
    })});
    const call = await client.calls.waitForResult("call_123",{intervalMs:1,timeoutMs:100});
    expect(call.result).toBeNull();
    expect(call.transcript).toEqual(transcript);
  });
  it("rejects removed scheduling input instead of silently placing an immediate call", async () => {
    const fetchMock = vi.fn();
    const input = {
      task: "Call.", phone: "+14155550100", region: "US", locale: "en-US",
      resultSchema: { type: "object", additionalProperties: false, properties: {} },
      scheduledAt: "2026-10-01T10:00:00Z",
    };
    const client = new CalleClient({ apiKey: "test", fetch: fetchMock });
    await expect(client.calls.create(input, { idempotencyKey: "schedule" })).rejects.toThrow("scheduledAt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it("cancels through the v2 endpoint without a technical error", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.heycall-e.com/v2/calls/call_123/cancel");
      return jsonResponse({ ...completedCall, status: "canceled", call_outcome: null,
        result_status: "not_applicable", result: null, error: null });
    });
    const call = await new CalleClient({ apiKey: "test", fetch: fetchMock }).calls.cancel("call_123");
    expect(call.resultStatus).toBe("not_applicable");
    expect(call.error).toBeNull();
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
    const queued = { ...completedCall, status: "queued", call_outcome: null, result_status: "pending", result: null, completed_at: null };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(queued))
      .mockResolvedValueOnce(jsonResponse({ ...completedCall, result_status: "pending", result: null }))
      .mockResolvedValueOnce(jsonResponse(completedCall));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["no_answer", "busy", "declined"])("finishes a %s call with no business result or error", async (outcome) => {
    const failed = {
      ...completedCall,
      status: "completed", call_outcome: outcome, result_status: "unavailable",
      result: null, error: null,
      completed_at: "2026-05-31T00:01:00Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(failed));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    const call = await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 500 });

    expect(call.status).toBe("completed");
    expect(call.callOutcome).toBe(outcome);
    expect(call.resultStatus).toBe("unavailable");
    expect(call.error).toBeNull();
  });

  it("treats an empty result as ready", async () => {
    const client = new CalleClient({ apiKey: "test", fetch: async () => jsonResponse({ ...completedCall, result_status: "available", result: {} }) });
    expect((await client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 100 })).result).toEqual({});
  });

  it("raises CalleTimeoutError when wait timeout is reached", async () => {
    const queued = { ...completedCall, status: "queued", call_outcome: null, result_status: "pending", result: null, completed_at: null };
    const fetchMock = vi.fn(async () => jsonResponse(queued));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(client.calls.waitForResult("call_123", { intervalMs: 1, timeoutMs: 2 })).rejects.toBeInstanceOf(
      CalleTimeoutError
    );
  });

  it("does not sleep past the requested timeout", async () => {
    vi.useFakeTimers();
    try {
      const queued = {
        ...completedCall,
        status: "queued",
        call_outcome: null,
        result_status: "pending",
        result: null,
        completed_at: null
      };
      const fetchMock = vi.fn(async () => jsonResponse(queued));
      const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });
      const waiting = client.calls.waitForResult("call_123", {
        intervalMs: 1000,
        timeoutMs: 25
      });
      const assertion = expect(waiting).rejects.toBeInstanceOf(CalleTimeoutError);

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-flight poll when the wait deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new Error("request aborted")),
            { once: true }
          );
        });
      });
      const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });
      const waiting = client.calls.waitForResult("call_123", {
        intervalMs: 1000,
        timeoutMs: 25
      });
      const assertion = expect(waiting).rejects.toBeInstanceOf(CalleTimeoutError);

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(fetchMock).toHaveBeenCalledOnce();
      const request = fetchMock.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return a completed body that arrives after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 180);
        });
        return jsonResponse(completedCall);
      });
      const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });
      const waiting = client.calls.waitForResult("call_123", {
        intervalMs: 180,
        timeoutMs: 30
      });
      const assertion = expect(waiting).rejects.toBeInstanceOf(CalleTimeoutError);

      await vi.advanceTimersByTimeAsync(180);

      await assertion;
      expect(fetchMock).toHaveBeenCalledOnce();
      const request = fetchMock.mock.calls[0]?.[0];
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { options: { intervalMs: 0 }, name: "zero intervalMs" },
    { options: { intervalMs: Number.NaN }, name: "NaN intervalMs" },
    { options: { timeoutMs: 0 }, name: "zero timeoutMs" },
    { options: { timeoutMs: Number.POSITIVE_INFINITY }, name: "infinite timeoutMs" }
  ])("rejects $name before polling", async ({ options }) => {
    const fetchMock = vi.fn(async () => jsonResponse(completedCall));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(client.calls.waitForResult("call_123", options)).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid create-and-wait options before creating a call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(completedCall));
    const client = new CalleClient({ apiKey: "key_test", baseUrl: "https://api.heycall-e.com", fetch: fetchMock });

    await expect(
      client.calls.createAndWait(
        {
          task: "Call.",
          phone: "+14155550100",
          region: "US",
          locale: "en-US",
          resultSchema: { type: "object", additionalProperties: false, properties: {} }
        },
        { idempotencyKey: "wf_123", timeoutMs: Number.NaN }
      )
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
