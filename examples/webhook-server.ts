import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { WebhookEvent } from "../src/index.js";

const port = Number(process.env.PORT ?? "3000");
const maxRequestBodyBytes = Number(
  process.env.CALLE_WEBHOOK_MAX_BODY_BYTES ?? "10485760"
);
const processedEventIds = new Set<string>();

class RequestBodyTooLargeError extends Error {}

if (!Number.isSafeInteger(maxRequestBodyBytes) || maxRequestBodyBytes <= 0) {
  throw new Error("CALLE_WEBHOOK_MAX_BODY_BYTES must be a positive integer.");
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/calle/webhook") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const event = JSON.parse(rawBody.toString("utf8")) as WebhookEvent;
    const eventId = request.headers["call-e-event-id"];
    if (typeof eventId !== "string" || eventId !== event.id) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_event_id" }));
      return;
    }
    if (processedEventIds.has(eventId)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: true, duplicate: true }));
      return;
    }

    // Use durable storage in production and persist the id before side effects.
    processedEventIds.add(eventId);
    if (event.type === "call.completed") {
      console.log("Call completed", {
        eventId,
        callId: event.data.id,
        taskCompleted: event.data.task_completed,
        completionConfidence: event.data.completion_confidence,
        evidence: event.data.evidence,
        structuredResult: event.data.structured_result,
        recipientResults: event.data.recipients.map(
          (recipient) => recipient.structured_result
        )
      });
    } else {
      console.log("CALL-E webhook event", {
        id: event.id,
        type: event.type,
        callId: event.data.id
      });
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ received: true }));
  } catch (error) {
    if (response.destroyed) {
      return;
    }

    const bodyTooLarge = error instanceof RequestBodyTooLargeError;
    response.writeHead(bodyTooLarge ? 413 : 400, {
      "content-type": "application/json"
    });
    response.end(
      JSON.stringify({ error: bodyTooLarge ? "payload_too_large" : "invalid_json" })
    );
  }
});

server.listen(port, () => {
  console.log(`CALL-E webhook server listening on http://localhost:${port}/calle/webhook`);
});

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bodyChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bodyChunk.length;
    if (totalBytes > maxRequestBodyBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(bodyChunk);
  }
  return Buffer.concat(chunks, totalBytes);
}
