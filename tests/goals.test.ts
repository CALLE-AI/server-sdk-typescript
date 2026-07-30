import { describe, expect, it, vi } from "vitest";
import { CalleAPIError, CalleClient, CalleTimeoutError } from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

const publishedGoal = {
  object: "goal",
  id: "goal_delivery",
  title: "Delivery window confirmation",
  description: "Confirm a delivery window or collect a preferred alternative.",
  status: "active",
  published_run_spec: {
    id: "rspec_delivery_v4",
    version: 4,
    input_schema: {
      type: "object",
      required: ["order_reference"],
      properties: { order_reference: { type: "string" } }
    },
    result_schema: {
      type: "object",
      required: ["delivery_outcome"],
      properties: { delivery_outcome: { type: "string" } }
    }
  }
} as const;

const queuedRun = {
  object: "goal_run",
  id: "rgrp_delivery_8472",
  goal_id: "goal_delivery",
  run_id: "run_delivery_8472",
  run_spec: { id: "rspec_delivery_v4", version: 4 },
  status: "queued",
  result: null,
  error: null,
  created_at: "2026-07-22T10:00:00Z",
  completed_at: null
} as const;

describe("CalleClient goals", () => {
  it("lists published Goals with pagination and camel-case models", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://api.heycall-e.com/v1/goals?limit=10&after=goalcur_next");
      expect(request.headers.get("authorization")).toBe("Bearer key_test");
      return jsonResponse({
        object: "list",
        data: [publishedGoal],
        next_cursor: "goalcur_later"
      });
    });
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const goals = await client.goals.list({ limit: 10, after: "goalcur_next" });

    expect(goals.nextCursor).toBe("goalcur_later");
    expect(goals.data[0]).toMatchObject({
      id: "goal_delivery",
      title: "Delivery window confirmation",
      description: "Confirm a delivery window or collect a preferred alternative.",
      publishedRunSpec: {
        id: "rspec_delivery_v4",
        version: 4
      }
    });
    expect(goals.data[0]?.publishedRunSpec.inputSchema).toEqual(
      publishedGoal.published_run_spec.input_schema
    );
  });

  it("gets one published Goal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe("https://api.heycall-e.com/v1/goals/goal_delivery");
      return jsonResponse(publishedGoal);
    });
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const goal = await client.goals.get("goal_delivery");

    expect(goal.publishedRunSpec.resultSchema).toEqual(
      publishedGoal.published_run_spec.result_schema
    );
  });

  it("creates a Goal Run with only phone, variables, and required idempotency identity", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.heycall-e.com/v1/goals/goal_delivery/runs");
      expect(request.headers.get("idempotency-key")).toBe("delivery:ORD-8472:v1");
      expect(await request.json()).toEqual({
        phone: "+14155550100",
        variables: { order_reference: "ORD-8472" }
      });
      return jsonResponse(queuedRun, { status: 201 });
    });
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const run = await client.goals.run({
      goalId: "goal_delivery",
      phone: "+14155550100",
      variables: { order_reference: "ORD-8472" },
      idempotencyKey: "delivery:ORD-8472:v1"
    });

    expect(run).toMatchObject({
      id: "rgrp_delivery_8472",
      goalId: "goal_delivery",
      runId: "run_delivery_8472",
      status: "queued",
      runSpec: { id: "rspec_delivery_v4", version: 4 }
    });
  });

  it("keeps polling a completed call until result materialization finishes", async () => {
    const materializing = {
      ...queuedRun,
      status: "completed",
      completed_at: "2026-07-22T10:01:00Z"
    };
    const succeeded = {
      ...materializing,
      result: { delivery_outcome: "confirmed" }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(materializing))
      .mockResolvedValueOnce(jsonResponse(succeeded));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const run = await client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", {
      intervalMs: 1,
      timeoutMs: 500
    });

    expect(run.result).toEqual({ delivery_outcome: "confirmed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a Goal Run domain error as data", async () => {
    const failed = {
      ...queuedRun,
      status: "failed",
      error: {
        code: "no_answer",
        message: "No human answered the call.",
        detail_code: "provider_no_answer"
      },
      completed_at: "2026-07-22T10:01:00Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(failed));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const run = await client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", {
      intervalMs: 1,
      timeoutMs: 500
    });

    expect(run.error).toEqual({
      code: "no_answer",
      message: "No human answered the call.",
      detailCode: "provider_no_answer"
    });
  });

  it("creates and waits using the returned Goal Run identity", async () => {
    const succeeded = {
      ...queuedRun,
      status: "completed",
      result: { delivery_outcome: "confirmed" },
      completed_at: "2026-07-22T10:01:00Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(queuedRun, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(succeeded));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const run = await client.goals.runAndWait(
      {
        goalId: "goal_delivery",
        phone: "+14155550100",
        idempotencyKey: "delivery:ORD-8472:v1"
      },
      { intervalMs: 1, timeoutMs: 500 }
    );

    const pollRequest = fetchMock.mock.calls[1]?.[0];
    const request = pollRequest instanceof Request ? pollRequest : new Request(String(pollRequest));
    expect(request.url).toBe(
      "https://api.heycall-e.com/v1/goals/goal_delivery/runs/rgrp_delivery_8472"
    );
    expect(run.result).toEqual({ delivery_outcome: "confirmed" });
  });

  it("returns a completed idempotent replay without polling again", async () => {
    const succeeded = {
      ...queuedRun,
      status: "completed",
      result: { delivery_outcome: "confirmed" },
      completed_at: "2026-07-22T10:01:00Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(succeeded, { status: 201 }));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    const run = await client.goals.runAndWait({
      goalId: "goal_delivery",
      phone: "+14155550100",
      idempotencyKey: "delivery:ORD-8472:v1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run.result).toEqual({ delivery_outcome: "confirmed" });
  });

  it("maps Goal API errors into CalleAPIError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "idempotency_conflict",
            message: "The key was already used with different input.",
            details: { key: "delivery:ORD-8472:v1" }
          }
        },
        { status: 409 }
      )
    );
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await expect(
      client.goals.run({
        goalId: "goal_delivery",
        phone: "+14155550100",
        idempotencyKey: "delivery:ORD-8472:v1"
      })
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409
    } satisfies Partial<CalleAPIError>);
  });

  it("raises CalleTimeoutError while result and error remain null", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(queuedRun));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await expect(
      client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", {
        intervalMs: 1,
        timeoutMs: 2
      })
    ).rejects.toBeInstanceOf(CalleTimeoutError);
  });

  it("does not sleep past the requested timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => jsonResponse(queuedRun));
      const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });
      const waiting = client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", {
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
      const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });
      const waiting = client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", {
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

  it.each([
    { options: { intervalMs: 0 }, name: "zero intervalMs" },
    { options: { intervalMs: Number.NaN }, name: "NaN intervalMs" },
    { options: { timeoutMs: 0 }, name: "zero timeoutMs" },
    { options: { timeoutMs: Number.POSITIVE_INFINITY }, name: "infinite timeoutMs" }
  ])("rejects $name before polling", async ({ options }) => {
    const fetchMock = vi.fn(async () => jsonResponse(queuedRun));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await expect(
      client.goals.waitForResult("goal_delivery", "rgrp_delivery_8472", options)
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid run-and-wait options before creating a real Goal Run", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(queuedRun, { status: 201 }));
    const client = new CalleClient({ apiKey: "key_test", fetch: fetchMock });

    await expect(
      client.goals.runAndWait(
        {
          goalId: "goal_delivery",
          phone: "+14155550100",
          idempotencyKey: "delivery:ORD-8472:v1"
        },
        { timeoutMs: Number.NaN }
      )
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
