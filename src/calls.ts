import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/schema.js";
import { CalleConnectionError, CalleTimeoutError, apiErrorFromResponse } from "./errors.js";

type ApiCall = components["schemas"]["CallTask"];
type ApiCreateCallRequest = components["schemas"]["CreateCallRequest"];
type ApiEventList = components["schemas"]["EventList"];
type FetchLike = (input: Request) => Promise<Response>;

export type JsonObject = Record<string, unknown>;
export type CallStatus = ApiCall["status"];

export interface CallRecipientInput {
  phones?: string[];
  phone?: string;
  locale?: string;
  region?: string;
}

export type CallTranscriptTurn = components["schemas"]["CallTranscriptTurn"];

export interface CallAttempt {
  id: string;
  phone: string;
  status: components["schemas"]["AttemptStatus"];
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  transcriptTurns: CallTranscriptTurn[];
  providerCallId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CallRecipient {
  id: string;
  phones: string[];
  locale: string | null;
  region: string | null;
  status: components["schemas"]["RecipientStatus"];
  structuredResult: JsonObject | null;
  summary: string | null;
  attempts: CallAttempt[];
}

export interface CreateCallInput {
  task: string;
  recipient?: CallRecipientInput;
  recipients?: CallRecipientInput[];
  resultSchema?: JsonObject | null;
  recipientResultSchema?: JsonObject | null;
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
  object: "call_task";
  status: CallStatus;
  task: string;
  recipients: CallRecipient[];
  structuredResult: JsonObject | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: components["schemas"]["CompletionConfidence"] | null;
  evidence: string[];
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

function toApiRecipient(input: CallRecipientInput): components["schemas"]["CallTaskRecipientRequest"] {
  const phones = input.phones ?? (input.phone !== undefined ? [input.phone] : []);
  const recipient: components["schemas"]["CallTaskRecipientRequest"] = { phones };
  if (input.locale !== undefined) {
    recipient.locale = input.locale;
  }
  if (input.region !== undefined) {
    recipient.region = input.region;
  }
  return recipient;
}

function toApiCreateCall(input: CreateCallInput): ApiCreateCallRequest {
  const body: Record<string, unknown> = {
    task: input.task
  };
  if (input.recipient !== undefined && input.recipients !== undefined) {
    throw new Error("Pass either recipient or recipients, not both.");
  }
  if (input.recipient !== undefined) {
    body.recipients = [toApiRecipient(input.recipient)];
  }
  if (input.recipients !== undefined) {
    body.recipients = input.recipients.map(toApiRecipient);
  }
  if (input.resultSchema !== undefined) {
    body.result_schema = input.resultSchema;
  }
  if (input.recipientResultSchema !== undefined) {
    body.recipient_result_schema = input.recipientResultSchema;
  }
  if (input.metadata !== undefined) {
    body.metadata = input.metadata;
  }
  if (input.webhookUrl !== undefined) {
    body.webhook_url = input.webhookUrl;
  }
  return body as ApiCreateCallRequest;
}

function fromApiAttempt(attempt: components["schemas"]["CallTaskAttempt"]): CallAttempt {
  return {
    id: attempt.id,
    phone: attempt.phone,
    status: attempt.status,
    startedAt: attempt.started_at,
    completedAt: attempt.completed_at,
    summary: attempt.summary ?? null,
    transcriptTurns: attempt.transcript_turns ?? [],
    providerCallId: attempt.provider_call_id ?? null,
    failureCode: attempt.failure_code ?? null,
    failureMessage: attempt.failure_message ?? null
  };
}

function fromApiRecipient(recipient: components["schemas"]["CallTaskRecipient"]): CallRecipient {
  return {
    id: recipient.id,
    phones: recipient.phones,
    locale: recipient.locale ?? null,
    region: recipient.region ?? null,
    status: recipient.status,
    structuredResult: recipient.structured_result ?? null,
    summary: recipient.summary ?? null,
    attempts: recipient.attempts.map(fromApiAttempt)
  };
}

function fromApiCall(call: ApiCall): Call {
  return {
    id: call.id,
    object: call.object,
    status: call.status,
    task: call.task,
    recipients: call.recipients.map(fromApiRecipient),
    structuredResult: call.structured_result ?? null,
    summary: call.summary ?? null,
    taskCompleted: call.task_completed ?? null,
    completionConfidence: call.completion_confidence ?? null,
    evidence: call.evidence ?? [],
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
