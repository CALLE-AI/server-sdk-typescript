import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CalleClient, CalleWebhookSignatureError } from "../src/index";

function sign(rawBody: Buffer, timestamp: string, secret: string): string {
  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]);
  return `v1=${createHmac("sha256", secret).update(signedPayload).digest("hex")}`;
}

describe("CalleClient webhooks", () => {
  it("verifies a valid CALL-E signature", () => {
    const client = new CalleClient({ apiKey: "key_test" });
    const rawBody = Buffer.from(
      '{"id":"evt_123","type":"call.completed","created_at":"2026-05-31T00:00:00Z","data":{"object":"call","id":"call_123","status":"completed"}}'
    );
    const timestamp = "1780035123";
    const signature = sign(rawBody, timestamp, "whsec_dev");

    expect(client.webhooks.verify({ rawBody, timestamp, signature, secret: "whsec_dev" })).toBe(true);
  });

  it("unwraps a valid event", () => {
    const client = new CalleClient({ apiKey: "key_test" });
    const rawBody = Buffer.from(
      '{"id":"evt_123","type":"call.completed","created_at":"2026-05-31T00:00:00Z","data":{"object":"call","id":"call_123","status":"completed"}}'
    );
    const timestamp = "1780035123";
    const signature = sign(rawBody, timestamp, "whsec_dev");

    const event = client.webhooks.unwrap({
      rawBody,
      headers: {
        "CALL-E-Timestamp": timestamp,
        "CALL-E-Signature": signature
      },
      secret: "whsec_dev"
    });

    expect(event.id).toBe("evt_123");
    expect(event.type).toBe("call.completed");
  });

  it("rejects invalid webhook signatures", () => {
    const client = new CalleClient({ apiKey: "key_test" });

    expect(() =>
      client.webhooks.unwrap({
        rawBody: Buffer.from('{"id":"evt_123"}'),
        headers: {
          "CALL-E-Timestamp": "1780035123",
          "CALL-E-Signature": "v1=bad"
        },
        secret: "whsec_dev"
      })
    ).toThrow(CalleWebhookSignatureError);
  });
});
