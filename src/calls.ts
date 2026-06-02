import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/schema";
import { CalleConnectionError, CalleTimeoutError, apiErrorFromResponse } from "./errors";

type ApiCall = components["schemas"]["Call"];
type ApiCreateCallRequest = components["schemas"]["CreateCallRequest"];
type ApiEventList = components["schemas"]["EventList"];
type FetchLike = (input: Request) => Promise<Response>;

export type JsonObject = Record<string, unknown>;
export type CallStatus = ApiCall["status"];

export interface CallRecipient {
  phone?: string;
  name?: string;
  locale?: string;
  region?: string;
}

export interface CreateCallInput {
  task: string;
  recipient: CallRecipient;
  context?: JsonObject;
  resultSchema: JsonObject;
  policy?: {
    maxAttempts?: number;
    voicemail?: "do_not_leave";
    onNotReady?: "error";
  };
  metadata?: JsonObject;
  webhookUrl?: string;
}

export interface RequestOptions {
  idempotencyKey?: string;
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface ListEventsOptions {
  cursor?: string;
  limit?: number;
}

export interface Call {
  id: string;
  status: CallStatus;
  task: string;
  recipient: CallRecipient;
  structuredResult: JsonObject | null;
  resultValidation: ApiCall["result_validation"];
  summary: string | null;
  transcript: string | null;
  metadata: JsonObject;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EventList {
  object: "list";
  data: components["schemas"]["DeveloperEvent"][];
  nextCursor: string | null;
}

function toApiCreateCall(input: CreateCallInput): ApiCreateCallRequest {
  const body: Record<string, unknown> = {
    task: input.task,
    recipient: input.recipient,
    result_schema: input.resultSchema
  };
  if (input.context !== undefined) {
    body.context = input.context;
  }
  if (input.policy !== undefined) {
    const policy: Record<string, unknown> = {};
    if (input.policy.maxAttempts !== undefined) {
      policy.max_attempts = input.policy.maxAttempts;
    }
    if (input.policy.voicemail !== undefined) {
      policy.voicemail = input.policy.voicemail;
    }
    if (input.policy.onNotReady !== undefined) {
      policy.on_not_ready = input.policy.onNotReady;
    }
    body.policy = policy;
  }
  if (input.metadata !== undefined) {
    body.metadata = input.metadata;
  }
  if (input.webhookUrl !== undefined) {
    body.webhook_url = input.webhookUrl;
  }
  return body as ApiCreateCallRequest;
}

function fromApiCall(call: ApiCall): Call {
  return {
    id: call.id,
    status: call.status,
    task: call.task,
    recipient: call.recipient,
    structuredResult: call.structured_result ?? null,
    resultValidation: call.result_validation ?? null,
    summary: call.summary ?? null,
    transcript: call.transcript ?? null,
    metadata: call.metadata ?? {},
    failureCode: call.failure_code ?? null,
    failureMessage: call.failure_message ?? null,
    createdAt: call.created_at,
    completedAt: call.completed_at ?? null
  };
}

function fromApiEventList(list: ApiEventList): EventList {
  return {
    object: "list",
    data: list.data,
    nextCursor: list.next_cursor ?? null
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class CalleCalls {
  private readonly client: Client<paths>;

  constructor(input: { baseUrl: string; apiKey: string; fetch?: FetchLike }) {
    const clientOptions: {
      baseUrl: string;
      fetch?: FetchLike;
      headers: Record<string, string>;
    } = {
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      headers: {
        authorization: `Bearer ${input.apiKey}`
      }
    };
    if (input.fetch !== undefined) {
      clientOptions.fetch = input.fetch;
    }
    this.client = createClient<paths>(clientOptions);
  }

  async create(input: CreateCallInput, options: RequestOptions = {}): Promise<Call> {
    const body = toApiCreateCall(input);
    const response =
      options.idempotencyKey !== undefined
        ? await this.client.POST("/v1/calls", {
            body,
            params: { header: { "Idempotency-Key": options.idempotencyKey } }
          })
        : await this.client.POST("/v1/calls", { body });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E create call returned no response body.");
    }
    return fromApiCall(response.data);
  }

  async get(callId: string): Promise<Call> {
    const response = await this.client.GET("/v1/calls/{call_id}", {
      params: { path: { call_id: callId } }
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E get call returned no response body.");
    }
    return fromApiCall(response.data);
  }

  async listEvents(callId: string, options: ListEventsOptions = {}): Promise<EventList> {
    const query: { cursor?: string; limit?: number } = {};
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }
    if (options.limit !== undefined) {
      query.limit = options.limit;
    }
    const response = await this.client.GET("/v1/calls/{call_id}/events", {
      params: {
        path: { call_id: callId },
        query
      }
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E list events returned no response body.");
    }
    return fromApiEventList(response.data);
  }

  async waitForResult(callId: string, options: WaitOptions = {}): Promise<Call> {
    const intervalMs = options.intervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 600000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const call = await this.get(callId);
      if (call.status === "completed" || call.status === "failed" || call.status === "canceled") {
        return call;
      }
      await sleep(intervalMs);
    }
    throw new CalleTimeoutError(`Timed out waiting for CALL-E call ${callId}.`);
  }

  async createAndWait(input: CreateCallInput, options: RequestOptions & WaitOptions = {}): Promise<Call> {
    const call = await this.create(input, options);
    return await this.waitForResult(call.id, options);
  }
}
