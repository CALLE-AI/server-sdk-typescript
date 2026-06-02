# @calle-ai/calle

TypeScript server SDK for the CALL-E Developer API.

Use this SDK from backend services, workers, and other trusted server
environments. Do not expose CALL-E API keys in browser code.

## Install

```bash
pnpm add @calle-ai/calle
```

## Quickstart

```ts
import { CalleClient } from "@calle-ai/calle";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!,
  baseUrl: "https://api.example.com"
});

const call = await client.calls.createAndWait(
  {
    task: "Call the recipient and ask whether they can attend Friday lunch in San Francisco.",
    recipient: { phone: "+14155550100", region: "US", locale: "en-US" },
    resultSchema: {
      type: "object",
      required: ["can_attend"],
      properties: {
        can_attend: { type: "string", enum: ["yes", "no", "unknown"] }
      },
      additionalProperties: false
    },
    metadata: { workflow_run_id: "wf_123" }
  },
  { idempotencyKey: "wf_123_friday_lunch" }
);

console.log(call.status, call.structuredResult);
```

## Webhook Verification

```ts
const event = client.webhooks.unwrap({
  rawBody,
  headers,
  secret: process.env.CALLE_WEBHOOK_SECRET!
});
```

## Release

This repository publishes the npm package `@calle-ai/calle`.

Prerequisites:

- Create an npm automation token or granular access token that can publish
  `@calle-ai/calle`.
- Add it to this repository as the GitHub Actions secret `NPM_TOKEN`.
- Keep the package version in `package.json` unique before each publish.

Manual beta publish:

1. Open the `Publish npm package` GitHub Actions workflow.
2. Run it from `main` with tag `beta`.
3. Verify install in a temporary project:

```bash
pnpm add @calle-ai/calle@beta
node --input-type=module -e 'import { CalleClient } from "@calle-ai/calle"; console.log(typeof CalleClient)'
```

Use tag `latest` only after the beta package has been installed and tested.
