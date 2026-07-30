import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "./generated/schema.js";
import { CalleWebhookSignatureError } from "./errors.js";

export type WebhookEvent = components["schemas"]["WebhookEvent"];

type HeaderMap = Headers | Record<string, string | string[] | undefined>;

function rawBodyToBuffer(rawBody: string | Buffer | Uint8Array): Buffer {
  if (typeof rawBody === "string") {
    return Buffer.from(rawBody, "utf8");
  }
  return Buffer.from(rawBody);
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) {
        return value[0];
      }
      return value;
    }
  }
  return undefined;
}

function signatureFor(input: { rawBody: string | Buffer | Uint8Array; timestamp: string; secret: string }): string {
  const rawBody = rawBodyToBuffer(input.rawBody);
  const signedPayload = Buffer.concat([Buffer.from(`${input.timestamp}.`, "utf8"), rawBody]);
  const digest = createHmac("sha256", input.secret).update(signedPayload).digest("hex");
  return `v1=${digest}`;
}

export class CalleWebhooks {
  /**
   * @deprecated Current CALL-E webhook deliveries are not signed. This helper
   * remains available for verifying legacy signed deliveries.
   */
  verify(input: { rawBody: string | Buffer | Uint8Array; timestamp: string; signature: string; secret: string }): boolean {
    const expected = signatureFor(input);
    const actual = Buffer.from(input.signature);
    const expectedBuffer = Buffer.from(expected);
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }

  /**
   * @deprecated Current CALL-E webhook deliveries do not include signature
   * headers. This helper remains available for legacy signed deliveries.
   */
  unwrap(input: {
    rawBody: string | Buffer | Uint8Array;
    headers: HeaderMap;
    secret: string;
  }): WebhookEvent {
    const timestamp = headerValue(input.headers, "CALL-E-Timestamp");
    const signature = headerValue(input.headers, "CALL-E-Signature");
    if (!timestamp || !signature) {
      throw new CalleWebhookSignatureError("Missing CALL-E webhook signature headers.");
    }
    if (!this.verify({ rawBody: input.rawBody, timestamp, signature, secret: input.secret })) {
      throw new CalleWebhookSignatureError("Invalid CALL-E webhook signature.");
    }
    return JSON.parse(rawBodyToBuffer(input.rawBody).toString("utf8")) as WebhookEvent;
  }
}
