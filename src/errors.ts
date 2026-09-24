export class CalleAPIError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  callId?: string;

  constructor(input: { code: string; message: string; status: number; details?: Record<string, unknown>; callId?: string }) {
    super(input.message);
    this.name = "CalleAPIError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? {};
    if (input.callId !== undefined) {
      this.callId = input.callId;
    }
  }
}

export class CalleAuthenticationError extends CalleAPIError {
  constructor(input: { code: string; message: string; status: number; details?: Record<string, unknown> }) {
    super(input);
    this.name = "CalleAuthenticationError";
  }
}

export class CalleRateLimitError extends CalleAPIError {
  constructor(input: { code: string; message: string; status: number; details?: Record<string, unknown> }) {
    super(input);
    this.name = "CalleRateLimitError";
  }
}

export class CalleTimeoutError extends Error {
  callId?: string;

  constructor(message: string, callId?: string) {
    super(message);
    this.name = "CalleTimeoutError";
    if (callId !== undefined) {
      this.callId = callId;
    }
  }
}

export class CalleConnectionError extends Error {
  callId?: string;

  constructor(message: string, callId?: string) {
    super(message);
    this.name = "CalleConnectionError";
    if (callId !== undefined) {
      this.callId = callId;
    }
  }
}

export class CalleWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalleWebhookSignatureError";
  }
}

export function apiErrorFromResponse(status: number, payload: unknown): CalleAPIError {
  const envelope = payload as { error?: { code?: unknown; message?: unknown; details?: unknown } };
  const code = typeof envelope.error?.code === "string" ? envelope.error.code : "internal_error";
  const message = typeof envelope.error?.message === "string" ? envelope.error.message : "CALL-E API request failed.";
  const details =
    envelope.error?.details && typeof envelope.error.details === "object"
      ? (envelope.error.details as Record<string, unknown>)
      : {};

  if (status === 401 || status === 403) {
    return new CalleAuthenticationError({ code, message, status, details });
  }
  if (status === 429) {
    return new CalleRateLimitError({ code, message, status, details });
  }
  return new CalleAPIError({ code, message, status, details });
}
