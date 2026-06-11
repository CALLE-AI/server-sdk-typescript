# @call-e/calle

TypeScript server SDK for the CALL-E Developer API.

Use this SDK from backend services, workers, and other trusted server
environments. Do not expose CALL-E API keys in browser code.

## Documentation

- Developer docs: <https://docs.heycall-e.com/>
- SDK guide: <https://docs.heycall-e.com/#/sdks>
- API Reference: <https://docs.heycall-e.com/#/api-reference>
- Webhooks: <https://docs.heycall-e.com/#/webhooks>
- Changelog: <https://docs.heycall-e.com/#/changelog>

## Install

Install the stable package from npm:

```bash
pnpm add @call-e/calle
```

Pin the current stable release when your deployment process requires exact package reproducibility:

```bash
pnpm add @call-e/calle@0.2.0
```

Use a local checkout for development and package smoke tests:

```bash
pnpm install
pnpm run validate
```

## Examples

Set the API key before running call examples:

```bash
export CALLE_API_KEY="calle_test_key"
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_EXAMPLE_PHONE="+14155550100"
```

Run the create-and-wait example from a local checkout:

```bash
pnpm run example:create-and-wait
```

Run the webhook receiver example:

```bash
export CALLE_WEBHOOK_SECRET="whsec_test_key"
pnpm run example:webhook
```

The webhook receiver listens on `POST /calle/webhook` and verifies
`CALL-E-Timestamp` and `CALL-E-Signature` against the raw request body.

## Quickstart

```ts
import { CalleClient } from "@call-e/calle";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!,
  baseUrl: "https://api.heycall-e.com"
});

const call = await client.calls.createAndWait(
  {
    task: "Call each recipient and ask whether they can attend Friday lunch in San Francisco.",
    recipients: [{ phones: ["+14155550100"], region: "US", locale: "en-US" }],
    resultSchema: {
      type: "object",
      required: ["completed_count"],
      properties: {
        completed_count: { type: "integer" }
      }
    },
    recipientResultSchema: {
      type: "object",
      required: ["can_attend"],
      properties: {
        can_attend: { type: "string", enum: ["yes", "no", "unknown"] }
      }
    },
    metadata: { workflow_run_id: "wf_123" }
  },
  { idempotencyKey: "wf_123_friday_lunch" }
);

console.log(call.status, call.structuredResult);
console.log(call.taskCompleted, call.completionConfidence, call.evidence);
console.log(call.recipients[0]?.structuredResult);
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

This repository publishes the npm package `@call-e/calle`.

See [RELEASE.md](./RELEASE.md) for the release checklist, GitHub Actions
workflow, and post-publish install smoke test.

Prerequisites:

- Create an npm automation token or granular access token that can publish
  `@call-e/calle`.
- Add it to this repository as the GitHub Actions secret `NPM_TOKEN`.
- Keep the package version in `package.json` unique before each publish.

Manual stable publish:

1. Confirm `package.json` has a unique stable version.
2. Open the `Publish npm package` GitHub Actions workflow.
3. Run it from `main` with tag `latest`.
4. Verify install in a temporary project:

```bash
pnpm add @call-e/calle
node --input-type=module -e 'import { CalleClient } from "@call-e/calle"; console.log(typeof CalleClient)'
```

The current stable version is `0.2.0`. Do not reuse a previously published npm version.

## Project Documents

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [RELEASE.md](./RELEASE.md)
