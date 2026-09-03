# Contributing

This SDK is the TypeScript server SDK for the CALL-E Developer API. It is meant
for trusted backend services, workers, and automation systems.

## Development setup

```bash
pnpm install
pnpm run validate
```

The validation command runs the tests and type checks, scans tracked files for
public-repository hygiene issues, builds the package, and smoke-tests the
generated tarball. The tarball is ignored by Git.

## Local examples

```bash
export CALLE_API_KEY="calle_test_key"
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_EXAMPLE_PHONE="+14155550100"
pnpm run example:create-and-wait

export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_GOAL_ID="<PUBLISHED_GOAL_ID>"
export CALLE_EXAMPLE_PHONE="<E164_PHONE>"
export CALLE_GOAL_VARIABLES='{"name":"Alex"}'
export CALLE_IDEMPOTENCY_KEY="<DURABLE_UNIQUE_BUSINESS_KEY>"
pnpm run example:goal-run

pnpm run example:webhook
```

The webhook example listens on `POST /calle/webhook` and processes terminal
event JSON without a webhook secret or signature headers. Terminal webhook data
includes the finalized post-call outcome and requested structured results.

## Supported API surface

In scope:

- Create a call.
- Read a call.
- Poll until a terminal call result.
- List call events.
- List and read published Goals.
- Create and poll Goal Runs until either `result` or `error` is available.
- Receive terminal webhook events.

Out of scope:

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

Add a concise entry under `Unreleased` in `CHANGELOG.md` for user-visible SDK
changes. Do not invent entries for releases that are not documented in this
repository.

## Pull requests

Keep changes small and focused. Include tests for wrapper behavior, error
handling, webhook event handling, and any changed API contract surface.

Do not add browser examples or patterns that expose CALL-E API keys to client
code.

Do not include private GitLab or collaboration links, raw non-loopback HTTP IP
addresses, or references to CALLE-AI repositories that have not been confirmed
public. The hygiene workflow checks tracked text plus the pull request title
and body, including after the pull request description is edited. Its findings
report only the location and violation type.

Maintainers publish stable packages from a matching `vX.Y.Z` GitHub Release.
Manual runs of the publish workflow are dry runs only. See [RELEASE.md](./RELEASE.md)
for the release and dist-tag procedures.

Unless stated otherwise, contributions are provided under the repository's
[MIT License](./LICENSE).
