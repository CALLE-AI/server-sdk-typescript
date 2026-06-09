# Contributing

This SDK is the TypeScript server SDK for the CALL-E Developer API. It is meant
for trusted backend services, workers, and automation systems.

## Development setup

```bash
pnpm install
pnpm run validate
```

## Local examples

```bash
export CALLE_API_KEY="calle_test_key"
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_EXAMPLE_PHONE="+14155550100"
pnpm run example:create-and-wait

export CALLE_WEBHOOK_SECRET="whsec_test_key"
pnpm run example:webhook
```

The webhook example listens on `POST /calle/webhook` and verifies
`CALL-E-Timestamp` plus `CALL-E-Signature` against the raw request body.

## Phase 1 scope

In scope:

- Create a call.
- Read a call.
- Poll until a terminal call result.
- List call events.
- Verify and unwrap signed webhook events.

Out of scope for Phase 1:

- Browser SDK support.
- Batch calls.
- Cancel calls.
- Recurring or scheduled calls.
- Project-level webhook management.
- Zod result schema helpers.

## API contract changes

The SDK types are generated from `openapi/calle.openapi.yaml`.

When the OpenAPI contract changes:

1. Update `openapi/calle.openapi.yaml`.
2. Run `pnpm run generate`.
3. Update wrappers and tests for any changed behavior.
4. Run the full development check list above.

## Pull requests

Keep changes small and focused. Include tests for wrapper behavior, error
handling, webhook signature verification, and any changed API contract surface.

Do not add browser examples or patterns that expose CALL-E API keys to client
code.
