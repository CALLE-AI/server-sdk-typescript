# Release

This repository publishes the TypeScript server SDK package
`@call-e/calle`.

## Current status

The first beta is published to npm:

```text
@call-e/calle@0.1.0-beta.1
```

Future releases require one of these release identities:

- GitHub Actions secret `NPM_TOKEN`, or
- npm Trusted Publishing configured for this repository and workflow.

## Release gates

Run these checks before publishing:

```bash
pnpm install
pnpm run validate
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
npm view @call-e/calle dist-tags version

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install @call-e/calle@beta
node --input-type=module -e 'import { CalleClient } from "@call-e/calle"; console.log(typeof CalleClient)'
```

## Dist-tags

npm currently reports both `beta` and `latest` for the first beta because this
is the only published version. Developer docs should continue to use
`@call-e/calle@beta` during the beta period.

Move `latest` only after a stable package has been approved, installed from npm,
and tested in at least one backend integration.

```bash
# Option A: publish a new version with latest from the workflow.
# Option B: promote an existing version after final approval.
npm dist-tag add @call-e/calle@<stable-version> latest
```

Do not reuse a previously published version. npm package versions are immutable.

## Registry identity notes

Token-based publishing requires an npm automation token or granular access token
with publish access for `@call-e/calle`.

npm Trusted Publishing is preferred once the repository is ready for public
release. The workflow uses a GitHub-hosted runner, Node.js 22.14.0, and upgrades
npm to 11.5.1 or newer when auth `trusted-publishing` is selected.

Configure the trusted publisher on npm for:

- Owner: `CALLE-AI`
- Repository: `server-sdk-typescript`
- Workflow filename: `publish-npm.yml`
- Environment name: `npm`
- Permission: allow `npm publish`

When using Trusted Publishing, run the workflow with auth
`trusted-publishing`. When using an npm token, run it with auth `token` and
configure the GitHub Actions secret `NPM_TOKEN`.

If the package already has token-based publishing enabled, first verify a
Trusted Publishing beta release, then consider restricting token-based publishing
in npm package settings.
