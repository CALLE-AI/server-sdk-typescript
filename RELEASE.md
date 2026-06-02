# Release

This repository publishes the TypeScript server SDK package
`@calle-ai/calle`.

## Current status

The package source, CI, and publish workflow are ready. The first registry
publish still requires one of these release identities:

- GitHub Actions secret `NPM_TOKEN`, or
- npm Trusted Publishing configured for this repository and workflow.

Until the first beta is published, use a local checkout for examples and
integration testing.

## Release gates

Run these checks before publishing:

```bash
pnpm install
pnpm run test
pnpm run typecheck
pnpm run typecheck:examples
pnpm run test:package
pnpm run pack:check
```

The CI workflow runs the same package checks on `main`.

## Beta publish

1. Confirm `package.json` has a unique beta version, for example
   `0.1.0-beta.1`.
2. Confirm GitHub Actions secret `NPM_TOKEN` is configured, unless the package
   has been moved to npm Trusted Publishing.
3. Open the `Publish npm package` workflow in GitHub Actions.
4. Run the workflow from `main` with tag `beta` and the selected release
   identity.
5. Confirm the workflow completes the post-publish install smoke test.

Manual verification:

```bash
npm view @calle-ai/calle dist-tags version

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install @calle-ai/calle@beta
node --input-type=module -e 'import { CalleClient } from "@calle-ai/calle"; console.log(typeof CalleClient)'
```

## Latest promotion

Use the `latest` dist-tag only after the beta package has been installed and
tested in at least one backend integration.

```bash
# Option A: publish a new version with latest from the workflow.
# Option B: promote an existing version after final approval.
npm dist-tag add @calle-ai/calle@0.1.0-beta.1 latest
```

Do not reuse a previously published version. npm package versions are immutable.

## Registry identity notes

Token-based publishing requires an npm automation token or granular access token
with publish access for `@calle-ai/calle`.

npm Trusted Publishing is preferred once the repository is ready for public
release. Configure it on npm for:

- Owner: `CALLE-AI`
- Repository: `server-sdk-typescript`
- Workflow filename: `publish-npm.yml`
- Environment name: `npm`

When using Trusted Publishing, run the workflow with auth
`trusted-publishing`. When using an npm token, run it with auth `token` and
configure the GitHub Actions secret `NPM_TOKEN`.
