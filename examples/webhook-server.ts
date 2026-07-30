import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { WebhookEvent } from "../src/index.js";

const port = Number(process.env.PORT ?? "3000");
const processedEventIds = new Set<string>();

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/calle/webhook") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const rawBody = await readRequestBody(request);

  try {
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
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_json" }));
  }
});

server.listen(port, () => {
  console.log(`CALL-E webhook server listening on http://localhost:${port}/calle/webhook`);
});

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
