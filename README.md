# @calle-ai/calle

TypeScript server SDK for the CALL-E Developer API.

Use this SDK from backend services, workers, and other trusted server
environments. Do not expose CALL-E API keys in browser code.

## Documentation

- Developer docs: <http://8.222.221.91:5204/calle-docs-site/>
- SDK guide: <http://8.222.221.91:5204/calle-docs-site/#/sdks>
- API Reference: <http://8.222.221.91:5204/calle-docs-site/#/api-reference>
- Webhooks: <http://8.222.221.91:5204/calle-docs-site/#/webhooks>
- Changelog: <http://8.222.221.91:5204/calle-docs-site/#/changelog>

## Install

The package name is planned for the first beta release, but it has not been
published to npm yet.

After the beta package is published:

```bash
pnpm add @calle-ai/calle
```

Before the first registry publish, use a local checkout for development and
package smoke tests:

```bash
pnpm install
pnpm run verify:openapi
pnpm run test:tarball
```

## Examples

Set the API key before running call examples:

```bash
export CALLE_API_KEY="calle_test_key"
export CALLE_BASE_URL="https://api.example.com"
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

See [RELEASE.md](./RELEASE.md) for the release checklist, GitHub Actions
workflow, and post-publish install smoke test.

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

## Project Documents

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [RELEASE.md](./RELEASE.md)
