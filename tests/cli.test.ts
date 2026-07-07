import { describe, expect, it, vi } from "vitest";
import { runCalleCli } from "../src/cli.js";
import type { Call, EventList } from "../src/index.js";

const completedCall: Call = {
  id: "call_123",
  object: "call_task",
  status: "completed",
  task: "Call.",
  recipients: [],
  structuredResult: null,
  summary: "Done.",
  taskCompleted: true,
  completionConfidence: { score: 0.92, label: "high" },
  evidence: ["The recipient said yes."],
  metadata: {},
  failureCode: null,
  failureMessage: null,
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

describe("calle CLI", () => {
  it("prints wait progress to stderr while keeping the final JSON on stdout", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const queuedCall: Call = {
      ...completedCall,
      status: "queued",
      structuredResult: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      completedAt: null
    };
    const inProgressCall: Call = {
      ...queuedCall,
      status: "in_progress"
    };
    const create = vi.fn(async () => queuedCall);
    const get = vi.fn().mockResolvedValueOnce(inProgressCall).mockResolvedValueOnce(completedCall);
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
        "--task",
        "Call and ask whether they can hear clearly.",
        "--wait",
        "--api-key",
        "cli_key",
        "--base-url",
        "https://test-api.heycall-e.com",
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
      baseUrl: "https://test-api.heycall-e.com"
    });
    expect(create).toHaveBeenCalledWith(
      {
        task: "Call and ask whether they can hear clearly.",
        recipients: [{ phones: ["+14155550100"] }]
      },
      {
        idempotencyKey: "idem_123"
      }
    );
    expect(createAndWait).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
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
});
