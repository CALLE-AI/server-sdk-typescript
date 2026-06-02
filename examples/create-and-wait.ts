import { CalleClient } from "../src/index.js";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY ?? "calle_dev_example",
  baseUrl: process.env.CALLE_BASE_URL ?? "https://api.example.com"
});

const call = await client.calls.createAndWait(
  {
    task: "Call the recipient and ask whether they can attend Friday lunch in San Francisco.",
    recipient: {
      phone: process.env.CALLE_EXAMPLE_PHONE ?? "+14155550100",
      region: "US",
      locale: "en-US"
    },
    resultSchema: {
      type: "object",
      required: ["can_attend"],
      properties: {
        can_attend: { type: "string", enum: ["yes", "no", "unknown"] }
      },
      additionalProperties: false
    },
    metadata: {
      workflow_run_id: "example_local"
    }
  },
  {
    idempotencyKey: "example_local_friday_lunch",
    intervalMs: 2000,
    timeoutMs: 600000
  }
);

console.log(JSON.stringify(call, null, 2));
