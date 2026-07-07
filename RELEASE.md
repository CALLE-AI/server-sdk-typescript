# Release

This repository publishes the TypeScript server SDK package `@call-e/calle`.

## Current status

The first beta is published to npm:

```text
@call-e/calle@0.1.0-beta.1
```

The current stable release version is:

```text
@call-e/calle@0.2.1
```

Release publishing requires one of these release identities:

- GitHub Actions secret `NPM_TOKEN`, or
- npm Trusted Publishing configured for this repository and workflow.

## Release gates

Run these checks before publishing:

```bash
pnpm install
pnpm run validate
```

The CI workflow runs the same package checks on `main`.

## Stable npm publish

1. Confirm `package.json` has a unique stable version.
2. Confirm GitHub Actions secret `NPM_TOKEN` is configured, unless the package has been moved to npm Trusted Publishing.
3. Open the `Publish npm package` workflow in GitHub Actions.
4. Run the workflow from `main` with tag `latest` and the selected release identity.
5. Confirm the workflow completes the post-publish install smoke test.

Manual verification:

```bash
npm view @call-e/calle dist-tags version

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install @call-e/calle@0.2.1
node --input-type=module -e 'import { CalleClient } from "@call-e/calle"; console.log(typeof CalleClient)'
```

## Dist-tags

The stable package should be available through the `latest` dist-tag.

If `latest` still points to an older version after the stable publish, correct it only after confirming `0.2.1` is visible:

```bash
npm dist-tag add @call-e/calle@0.2.1 latest
npm dist-tag ls @call-e/calle
```

Keep the `beta` dist-tag for prerelease versions. Do not move `beta` to a stable version.

Do not reuse a previously published version. npm package versions are immutable.

## Version rules

- Patch releases fix SDK wrapper bugs, type issues, packaging metadata, README examples, or distribution issues without changing public API behavior.
- Minor releases add backward-compatible API fields, endpoints, or SDK helpers.
- Major releases make breaking public API, method signature, stable error, or webhook signature contract changes.

Keep TypeScript, Python, OpenAPI, and public docs versions aligned by default. A single-language patch is allowed only when the shared API contract and cross-language behavior do not change.

## Registry identity notes

Token-based publishing requires an npm automation token or granular access token with publish access for `@call-e/calle`.

npm Trusted Publishing is preferred once the repository is ready for public release. The workflow uses a GitHub-hosted runner, Node.js 22.14.0, and upgrades npm to 11.5.1 or newer when auth `trusted-publishing` is selected.

Configure the trusted publisher on npm for:

- Owner: `CALLE-AI`
- Repository: `server-sdk-typescript`
- Workflow filename: `publish-npm.yml`
- Environment name: `npm`
- Permission: allow `npm publish`

When using Trusted Publishing, run the workflow with auth `trusted-publishing`. When using an npm token, run it with auth `token` and configure the GitHub Actions secret `NPM_TOKEN`.
