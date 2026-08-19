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
pnpm add @call-e/calle@0.7.0
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

Run a published Goal and wait for its structured result:

```bash
export CALLE_BASE_URL="https://test-api.heycall-e.com"
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
the body `id`.

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
npx @call-e/calle@0.7.0 goals run \
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

The current stable version is `0.7.0`. Do not reuse a previously published npm
version.

## Project Documents

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [RELEASE.md](./RELEASE.md)
