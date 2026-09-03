# @call-e/calle

[![npm version](https://img.shields.io/npm/v/%40call-e%2Fcalle)](https://www.npmjs.com/package/@call-e/calle)
[![CI](https://github.com/CALLE-AI/server-sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/CALLE-AI/server-sdk-typescript/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

TypeScript server SDK for the CALL-E Developer API.

Use this SDK from backend services, workers, and other trusted server
environments. Do not expose CALL-E API keys in browser code.

## Documentation

- Developer docs: <https://docs.heycall-e.com/>
- SDK guide: <https://docs.heycall-e.com/#/sdks>
- API Reference: <https://docs.heycall-e.com/#/api-reference>
- Webhooks: <https://docs.heycall-e.com/#/webhooks>
- Changelog: <https://docs.heycall-e.com/#/changelog>
- Python server SDK: <https://github.com/CALLE-AI/server-sdk-python>

## SDK surface

- `client.calls` creates, reads, and polls call tasks and lists call events.
- `client.goals` lists and reads published Goals and runs them with typed
  results.
- The `calle` CLI supports common Calls and Goals workflows from scripts and
  terminals.
- `examples/webhook-server.ts` shows how to receive current terminal webhook
  events.

## Install

Install the stable package from npm:

```bash
pnpm add @call-e/calle
```

Use a local checkout for development and package smoke tests:

```bash
pnpm install
pnpm run validate
```

## Configuration

Create one `CalleClient` and reuse it for Calls and Goals requests:

| Option | Required | Description |
| --- | --- | --- |
| `apiKey` | Yes | CALL-E API key. Load it from a server-side secret store or environment variable. |
| `baseUrl` | No | API base URL. Defaults to `https://api.heycall-e.com`. |
| `fetch` | No | Fetch-compatible function for a custom transport or test harness. |

Polling helpers accept interval and timeout options. See the method signatures
in your editor and the [SDK guide](https://docs.heycall-e.com/#/sdks) for
details.

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

Run a published Goal and wait for its structured result:

```bash
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_GOAL_ID="<PUBLISHED_GOAL_ID>"
export CALLE_EXAMPLE_PHONE="<E164_PHONE>"
export CALLE_GOAL_VARIABLES='{"name":"Alex"}'
export CALLE_IDEMPOTENCY_KEY="<DURABLE_UNIQUE_BUSINESS_KEY>"
pnpm run example:goal-run
```

The Goal example performs a real call. Use an API key, Goal, phone number, and
idempotency key for the selected environment. Persist and reuse the same key
when retrying the same logical request.

Run the CLI from npm with `npx`:

```bash
npx @call-e/calle@latest calls create \
  --api-key "$CALLE_API_KEY" \
  --base-url "https://api.heycall-e.com" \
  --phone "+14155550100" \
  --task "Call this person and ask whether they can hear clearly." \
  --wait \
  --json
```

`--api-key` overrides `CALLE_API_KEY`. Prefer `CALLE_API_KEY` for shared scripts
because command-line arguments may be stored in shell history.
When `--wait` is used, progress messages are printed to stderr and the final
call result is printed to stdout. Progress includes call status changes and any
developer events returned by the call events API.

Query an existing call:

```bash
npx @call-e/calle@latest calls get call_123 --api-key "$CALLE_API_KEY" --json
```

Run the webhook receiver example:

```bash
pnpm run example:webhook
```

The webhook receiver listens on `POST /calle/webhook` and processes terminal
event JSON without a webhook secret or signature headers. CALL-E sends the
event only after the post-call outcome and requested structured results are
finalized. Deduplicate side effects with the event `id` or
`CALL-E-Event-Id`, and reject events when the required header does not match
the body `id`. The example defaults to a 10 MiB request-body limit and returns
`413` for larger payloads. Set `CALLE_WEBHOOK_MAX_BODY_BYTES` to match your
provider and ingress limits.

The `client.webhooks.verify` and signed `client.webhooks.unwrap` methods
implement the legacy SDK `0.2` contract. They remain available for source
compatibility but are deprecated and are not compatible with current unsigned
CALL-E deliveries.

## Quickstart

Run a reusable published Goal. The Goal owns its input and result schemas;
each Run supplies only a phone number, per-Run variables, and a durable
idempotency key:

```ts
import { CalleClient } from "@call-e/calle";

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!
});

const goal = await client.goals.get("goal_delivery_confirmation");
console.log(goal.title, goal.publishedRunSpec.inputSchema);

const run = await client.goals.runAndWait({
  goalId: goal.id,
  phone: "+14155550100",
  variables: {
    customer_name: "Taylor",
    order_reference: "ORD-8472",
    delivery_window: "July 24, 2:00-4:00 PM"
  },
  idempotencyKey: "delivery:ORD-8472:confirm-window:v1"
});

if (run.result !== null) {
  console.log(run.callId);
  console.log(run.result);
} else {
  console.error(run.error);
}
```

Run the same published Goal through the CLI:

```bash
npx @call-e/calle@latest goals run \
  --goal-id "goal_delivery_confirmation" \
  --phone "+14155550100" \
  --variables '{"customer_name":"Taylor","order_reference":"ORD-8472","delivery_window":"July 24, 2:00-4:00 PM"}' \
  --idempotency-key "delivery:ORD-8472:confirm-window:v1" \
  --wait \
  --json
```

Persist the idempotency key before the first request and reuse it for network
retries. `waitForResult` returns when either `result` or `error` is non-null;
an execution `status` of `completed` can still be waiting for result
materialization.

The generic one-shot call API remains available independently:

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

## Error handling

The SDK exports typed errors for API responses, authentication, rate limits,
polling timeouts, and missing response bodies:

```ts
import { CalleAPIError, CalleClient } from "@call-e/calle";

const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY! });

try {
  await client.calls.get("call_123");
} catch (error) {
  if (error instanceof CalleAPIError) {
    console.error(error.status, error.code, error.details);
  }
  throw error;
}
```

## Release

This repository publishes the npm package `@call-e/calle`.

Merging to `main` runs CI and does not publish the package. Publishing a GitHub
Release with a matching `vX.Y.Z` tag starts the npm release workflow. Manual
workflow runs are dry runs only. See [RELEASE.md](./RELEASE.md) for release
gates and registry checks.

## Support and security

Use [GitHub Issues](https://github.com/CALLE-AI/server-sdk-typescript/issues)
for reproducible SDK bugs and feature requests. Do not report vulnerabilities
in a public issue. Follow [SECURITY.md](./SECURITY.md) for private reporting.

## Project Documents

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [SECURITY.md](./SECURITY.md)
- [RELEASE.md](./RELEASE.md)

## License

This project is licensed under the [MIT License](./LICENSE). The same license
applies to the published npm packages `@call-e/calle@0.6.0` and
`@call-e/calle@0.7.0`.
