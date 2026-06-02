import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { CalleClient, CalleWebhookSignatureError } from "../src/index.js";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY ?? "calle_dev_example"
});

const webhookSecret = process.env.CALLE_WEBHOOK_SECRET ?? "whsec_dev_example";
const port = Number(process.env.PORT ?? "3000");

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/calle/webhook") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const rawBody = await readRequestBody(request);

  try {
    const event = client.webhooks.unwrap({
      rawBody,
      headers: request.headers,
      secret: webhookSecret
    });

    if (event.type === "call.completed") {
      console.log("Call completed", {
        callId: event.data.id,
        result: event.data.structured_result
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
    if (error instanceof CalleWebhookSignatureError) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_signature" }));
      return;
    }

    throw error;
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
