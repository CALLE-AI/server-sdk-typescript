import createClient, { type Client } from "openapi-fetch";
import type { GoalResult, GoalRunError } from "./goals.js";
import type { components, paths } from "./generated/schema.js";
import {
  CalleAPIError,
  CalleConnectionError,
  CalleTimeoutError,
  apiErrorFromResponse
} from "./errors.js";

type ApiCall = components["schemas"]["AgenticCall"];
type ApiCreateCallRequest = components["schemas"]["CreateAgenticCallRequest"];
type ApiEventList = components["schemas"]["EventList"];
type FetchLike = (input: Request) => Promise<Response>;

export type JsonObject = Record<string, unknown>;
export type CallStatus = ApiCall["status"];

export interface CreateCallInput {
  task: string;
  phone: string;
  region?: string | null;
  locale?: string | null;
  resultSchema: JsonObject;
  metadata?: JsonObject;
  webhookUrl?: string;
}

export interface RequestOptions {
  idempotencyKey: string;
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
  callId: string | null;
  object: "call";
  status: CallStatus;
  callOutcome: ApiCall["call_outcome"];
  resultStatus: ApiCall["result_status"];
  transcript: ApiCall["transcript"];
  task: string;
  phone: string;
  region: string;
  locale: string;
  result: GoalResult | null;
  error: GoalRunError | null;
  metadata: JsonObject;
  createdAt: string;
  completedAt: string | null;
}

export interface EventList {
  object: "list";
  data: components["schemas"]["DeveloperEvent"][];
  nextCursor: string | null;
}

function toApiCreateCall(input: CreateCallInput): ApiCreateCallRequest {
  return {
    task: input.task, phone: input.phone,
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    result_schema: input.resultSchema,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.webhookUrl !== undefined ? { webhook_url: input.webhookUrl } : {})
  };
}

function fromApiCall(call: ApiCall): Call {
  return {
    id: call.id,
    callId: call.call_id,
    object: call.object,
    status: call.status,
    callOutcome: call.call_outcome,
    resultStatus: call.result_status,
    transcript: call.transcript,
    task: call.task,
    phone: call.phone,
    region: call.region,
    locale: call.locale,
    result: call.result,
    error: call.error === null ? null : {
      code: call.error.code, message: call.error.message, detailCode: call.error.detail_code
    },
    metadata: call.metadata ?? {},
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

function wrapFetch(fetchImpl: FetchLike): FetchLike {
  return (async (input: Request, init?: RequestInit) => {
    try {
      return await (fetchImpl as (input: Request, init?: RequestInit) => Promise<Response>)(input, init);
    } catch (error) {
      if (
        error instanceof CalleConnectionError ||
        error instanceof CalleAPIError ||
        error instanceof CalleTimeoutError
      ) {
        throw error;
      }
      const detail = error instanceof Error && error.message ? error.message : "unknown error";
      throw new CalleConnectionError(`CALL-E API request failed: ${detail}`);
    }
  }) as FetchLike;
}

function attachCallId<T extends { callId?: string }>(error: T, callId: string): T {
  error.callId = callId;
  return error;
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
    clientOptions.fetch = wrapFetch(input.fetch ?? ((request) => globalThis.fetch(request)));
    this.client = createClient<paths>(clientOptions);
  }

  async create(input: CreateCallInput, options: RequestOptions): Promise<Call> {
    if ("scheduledAt" in input) {
      throw new Error("scheduledAt is not supported; Calls accept immediate execution only.");
    }
    if (!options?.idempotencyKey?.trim()) {
      throw new Error("A stable idempotencyKey is required.");
    }
    const response = await this.client.POST("/v2/calls", {
      body: toApiCreateCall(input),
      params: { header: { "Idempotency-Key": options.idempotencyKey } }
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E create call returned no response body.");
    }
    return fromApiCall(response.data);
  }

  async get(callId: string): Promise<Call> {
    const response = await this.client.GET("/v2/calls/{call_id}", {
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

  async cancel(callId: string): Promise<Call> {
    const response = await this.client.POST("/v2/calls/{call_id}/cancel", {
      params: { path: { call_id: callId } }
    });
    if (response.error) throw apiErrorFromResponse(response.response.status, response.error);
    if (!response.data) throw new CalleConnectionError("CALL-E cancel returned no response body.");
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
    const response = await this.client.GET("/v2/calls/{call_id}/events", {
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
      if (call.resultStatus !== "pending") {
        return call;
      }
      await sleep(intervalMs);
    }
    throw new CalleTimeoutError(`Timed out waiting for CALL-E call ${callId}.`, callId);
  }

  async createAndWait(input: CreateCallInput, options: RequestOptions & WaitOptions): Promise<Call> {
    const call = await this.create(input, options);
    try {
      return await this.waitForResult(call.id, options);
    } catch (error) {
      if (
        error instanceof CalleAPIError ||
        error instanceof CalleConnectionError ||
        error instanceof CalleTimeoutError
      ) {
        throw attachCallId(error, call.id);
      }
      const detail = error instanceof Error && error.message ? error.message : "unknown error";
      throw new CalleConnectionError(`CALL-E wait failed: ${detail}`, call.id);
    }
  }
}
