import { describe, expect, it, vi } from "vitest";
import { runCalleCli } from "../src/cli.js";
import type { Call, EventList, GoalRun } from "../src/index.js";

const completedCall: Call = {
  transcript: [],
  callOutcome: "completed", resultStatus: "available",
  id: "call_123",
  callId: "billing_call_123",
  object: "call",
  status: "completed",
  task: "Call.",
  phone: "+14155550100", region: "US", locale: "en-US",
  result: {}, error: null,
  metadata: {},
  createdAt: "2026-05-31T00:00:00Z",
  completedAt: "2026-05-31T00:01:00Z"
};

const connectedEvents: EventList = {
  object: "list",
  data: [
    {
      id: "evt_1",
      type: "call.in_progress",
      call_id: "call_123",
      created_at: "2026-05-31T00:00:10Z",
      level: "info",
      status: "in_progress",
      message: "Call connected.",
      details: {}
    },
    {
      id: "evt_2",
      type: "call.updated",
      call_id: "call_123",
      created_at: "2026-05-31T00:00:12Z",
      level: "info",
      status: "in_progress",
      message: "Callee said: Hello.",
      details: { method: "asr", turn: 1 }
    }
  ],
  nextCursor: "2-0"
};

const emptyEvents: EventList = {
  object: "list",
  data: [],
  nextCursor: "2-0"
};

const completedGoalRun: GoalRun = {
  transcript: [],
  callOutcome: "completed", resultStatus: "available",
  object: "goal_run",
  id: "rgrp_delivery_8472",
  goalId: "goal_delivery",
  runId: "run_delivery_8472",
  callId: "calling_call_delivery_8472",
  runSpec: { id: "rspec_delivery_v4", version: 4 },
  status: "completed",
  result: {
    delivery_outcome: "confirmed"
  },
  error: null,
  createdAt: "2026-07-23T04:00:00Z",
  completedAt: "2026-07-23T04:01:00Z"
};

const failedGoalRun: GoalRun = {
  ...completedGoalRun,
  status: "failed",
  result: null,
  error: {
    code: "no_answer",
    message: "No human answered the call.",
    detailCode: "provider_no_answer"
  }
};

describe("calle CLI", () => {
  it.each([true, false])("finishes unavailable results without result or error, replay=%s", async (replay) => {
    const final: Call = { ...completedCall, callOutcome: "no_answer", resultStatus: "unavailable", result: null };
    const queued: Call = { ...final, status: "queued", callOutcome: null, resultStatus: "pending", completedAt: null };
    const get = vi.fn(async () => final);
    const stdout: string[] = [];
    const code = await runCalleCli({
      argv: ["calls", "create", "--phone", "+14155550100", "--task", "Say hello.",
        "--result-schema", '{"type":"object","properties":{},"additionalProperties":false}',
        "--idempotency-key", "stable", "--wait", "--json", "--interval-ms", "1", "--timeout-ms", "100"],
      env: { CALLE_API_KEY: "test" },
      stdout: text => stdout.push(text), stderr: () => undefined,
      createClient: () => ({calls: {create: async () => replay ? final : queued, createAndWait: vi.fn(), get, listEvents: async () => emptyEvents}}),
    });
    expect(code).toBe(0);
    expect(get).toHaveBeenCalledTimes(replay ? 0 : 1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({resultStatus: "unavailable", result: null, error: null});
  });

  it.each([true, false])("prints wait progress with explicit target hints=%s", async (withHints) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const queuedCall: Call = {
      ...completedCall,
      status: "queued",
      resultStatus: "pending",
      result: null,
      completedAt: null
    };
    const inProgressCall: Call = {
      ...queuedCall,
      status: "in_progress"
    };
    const create = vi.fn(async () => queuedCall);
    const get = vi.fn().mockResolvedValueOnce(inProgressCall).mockResolvedValueOnce({ ...completedCall, resultStatus: "pending", result: null }).mockResolvedValueOnce(completedCall);
    const listEvents = vi.fn().mockResolvedValueOnce(connectedEvents).mockResolvedValue(emptyEvents);
    const createAndWait = vi.fn();
    const createClient = vi.fn(() => ({
      calls: {
        create,
        createAndWait,
        get,
        listEvents
      }
    }));

    const exitCode = await runCalleCli({
      argv: [
        "calls",
        "create",
        "--phone",
        "+14155550100",
        ...(withHints ? ["--region", "US", "--locale", "en-US"] : []),
        "--result-schema", '{"type":"object","properties":{},"additionalProperties":false}',
        "--task",
        "Call and ask whether they can hear clearly.",
        "--wait",
        "--api-key",
        "cli_key",
        "--base-url",
        "https://api.example.test",
        "--idempotency-key",
        "idem_123",
        "--interval-ms",
        "1",
        "--timeout-ms",
        "100",
        "--json"
      ],
      env: { CALLE_API_KEY: "env_key" },
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(0);
    expect(createClient).toHaveBeenCalledWith({
      apiKey: "cli_key",
      baseUrl: "https://api.example.test"
    });
    expect(create).toHaveBeenCalledWith(
      {
        task: "Call and ask whether they can hear clearly.",
        phone: "+14155550100", ...(withHints ? {region: "US", locale: "en-US"} : {}),
        resultSchema: { type: "object", properties: {}, additionalProperties: false }
      },
      {
        idempotencyKey: "idem_123"
      }
    );
    expect(createAndWait).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(3);
    expect(listEvents).toHaveBeenCalledWith("call_123", { limit: 100 });
    expect(listEvents).toHaveBeenCalledWith("call_123", { cursor: "2-0", limit: 100 });
    expect(stderr.join("")).toContain("Creating call task...");
    expect(stderr.join("")).toContain("Created call_123 with status queued.");
    expect(stderr.join("")).toContain("Waiting for call result...");
    expect(stderr.join("")).toContain("Event: Call connected.");
    expect(stderr.join("")).toContain("Event: Callee said: Hello.");
    expect(stderr.join("")).toContain("Status: in_progress");
    expect(stderr.join("")).toContain("Status: completed");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ id: "call_123", status: "completed" });
  });

  it("returns an error when no API key is provided", async () => {
    const stderr: string[] = [];
    const createClient = vi.fn();

    const exitCode = await runCalleCli({
      argv: ["calls", "create", "--phone", "+14155550100", "--task", "Call."],
      env: {},
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("Missing API key");
  });

  it("gets a call by id with --api-key", async () => {
    const stdout: string[] = [];
    const get = vi.fn(async () => completedCall);
    const createClient = vi.fn(() => ({
      calls: {
        create: vi.fn(),
        createAndWait: vi.fn(),
        get,
        listEvents: vi.fn()
      }
    }));

    const exitCode = await runCalleCli({
      argv: ["calls", "get", "call_123", "--api-key", "cli_key", "--json"],
      env: {},
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      createClient
    });

    expect(exitCode).toBe(0);
    expect(createClient).toHaveBeenCalledWith({ apiKey: "cli_key" });
    expect(get).toHaveBeenCalledWith("call_123");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ id: "call_123", status: "completed" });
  });

  it("runs and waits for a published Goal with scalar variables", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const run = vi.fn();
    const runAndWait = vi.fn(async () => completedGoalRun);
    const createClient = vi.fn(() => ({
      calls: {
        create: vi.fn(),
        createAndWait: vi.fn(),
        get: vi.fn(),
        listEvents: vi.fn()
      },
      goals: {
        run,
        runAndWait
      }
    }));

    const exitCode = await runCalleCli({
      argv: [
        "goals",
        "run",
        "--goal-id",
        "goal_delivery",
        "--phone",
        "+14155550100",
        "--variables",
        '{"order_reference":"ORD-8472"}',
        "--idempotency-key",
        "delivery:ORD-8472:v1",
        "--wait",
        "--interval-ms",
        "1000",
        "--timeout-ms",
        "600000",
        "--api-key",
        "cli_key",
        "--base-url",
        "http://127.0.0.1:8000",
        "--json"
      ],
      env: {},
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(0);
    expect(createClient).toHaveBeenCalledWith({
      apiKey: "cli_key",
      baseUrl: "http://127.0.0.1:8000"
    });
    expect(runAndWait).toHaveBeenCalledWith(
      {
        goalId: "goal_delivery",
        phone: "+14155550100",
        variables: { order_reference: "ORD-8472" },
        idempotencyKey: "delivery:ORD-8472:v1"
      },
      {
        intervalMs: 1000,
        timeoutMs: 600000
      }
    );
    expect(run).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("Creating and waiting for Goal Run result...");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "rgrp_delivery_8472",
      result: { delivery_outcome: "confirmed" }
    });
  });

  it("returns an error exit code when a waited Goal Run has a domain error", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runAndWait = vi.fn(async () => failedGoalRun);
    const createClient = vi.fn(() => ({
      calls: {
        create: vi.fn(),
        createAndWait: vi.fn(),
        get: vi.fn(),
        listEvents: vi.fn()
      },
      goals: {
        run: vi.fn(),
        runAndWait
      }
    }));

    const exitCode = await runCalleCli({
      argv: [
        "goals",
        "run",
        "--goal-id",
        "goal_delivery",
        "--phone",
        "+14155550100",
        "--idempotency-key",
        "delivery:ORD-8472:v1",
        "--wait",
        "--api-key",
        "cli_key",
        "--json"
      ],
      env: {},
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "rgrp_delivery_8472",
      error: { code: "no_answer" }
    });
    expect(stderr.join("")).toContain("Goal Run rgrp_delivery_8472 failed");
  });

  it("returns an error exit code for an immediate failed Goal Run replay", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const run = vi.fn(async () => failedGoalRun);
    const runAndWait = vi.fn();
    const createClient = vi.fn(() => ({
      calls: {
        create: vi.fn(),
        createAndWait: vi.fn(),
        get: vi.fn(),
        listEvents: vi.fn()
      },
      goals: {
        run,
        runAndWait
      }
    }));

    const exitCode = await runCalleCli({
      argv: [
        "goals",
        "run",
        "--goal-id",
        "goal_delivery",
        "--phone",
        "+14155550100",
        "--idempotency-key",
        "delivery:ORD-8472:v1",
        "--api-key",
        "cli_key",
        "--json"
      ],
      env: {},
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(1);
    expect(run).toHaveBeenCalledOnce();
    expect(runAndWait).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "rgrp_delivery_8472",
      error: { code: "no_answer" }
    });
    expect(stderr.join("")).toContain("Goal Run rgrp_delivery_8472 failed");
  });

  it("requires an explicit idempotency key for Goal Runs", async () => {
    const stderr: string[] = [];
    const run = vi.fn();
    const createClient = vi.fn(() => ({
      calls: {
        create: vi.fn(),
        createAndWait: vi.fn(),
        get: vi.fn(),
        listEvents: vi.fn()
      },
      goals: {
        run,
        runAndWait: vi.fn()
      }
    }));

    const exitCode = await runCalleCli({
      argv: [
        "goals",
        "run",
        "--goal-id",
        "goal_delivery",
        "--phone",
        "+14155550100",
        "--api-key",
        "cli_key"
      ],
      env: {},
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("Goal Runs require --idempotency-key");
  });

  it.each([
    {
      name: "--goal-id on calls create",
      argv: ["calls", "create", "--task", "Call.", "--goal-id", "goal_delivery"],
      message: "--goal-id is only accepted for Goal commands"
    },
    {
      name: "--variables on calls get",
      argv: ["calls", "get", "call_123", "--variables", '{"name":"Alex"}'],
      message: "--variables is only accepted for Goal commands"
    }
  ])("rejects $name", async ({ argv, message }) => {
    const stderr: string[] = [];
    const createClient = vi.fn();

    const exitCode = await runCalleCli({
      argv,
      env: {},
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
      createClient
    });

    expect(exitCode).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain(message);
  });
});
