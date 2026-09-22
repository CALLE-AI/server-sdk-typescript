# Release

This repository publishes the TypeScript server SDK package `@call-e/calle`.
Merging to `main` never publishes the package.

## Release identities and protection

Package publishing uses npm Trusted Publishing from the `publish-npm.yml`
workflow. Configure the trusted publisher on npm with:

- Owner: `CALLE-AI`
- Repository: `server-sdk-typescript`
- Workflow filename: `publish-npm.yml`
- Environment name: `npm`
- Allowed action: `npm publish`

The GitHub `npm` environment should require maintainer approval and allow
deployments only from `main` and `v*` release tags. The publish job uses OIDC
and does not read a long-lived npm token. `NPM_TOKEN` is retained only for the
separate, manually invoked dist-tag management workflow.

## Release gates

Run the full local check before opening the version PR:

```bash
pnpm install
pnpm run validate
```

`validate` checks the OpenAPI contract, tests, types, examples, public-repository
hygiene, the built package, and an install from the single generated tarball.
It also verifies that the tarball includes `LICENSE`. CI runs the full check on
Linux and the packaged CLI installation check on Windows and macOS.

## CLI command migration

Renaming the SDK command from `calle` to `calle-api` is a breaking CLI change.
The SDK no longer installs a `calle` alias; that name belongs to the separate
MCP CLI package, `@call-e/cli`.

Before publishing the rename, migrate shell scripts, npm scripts, CI jobs, and
deployment commands that invoke the SDK to `calle-api`. Keep the existing
Developer API arguments, `CALLE_API_KEY`, and `CALLE_BASE_URL` settings. Do not
rename MCP commands to `calle-api`.
Follow the [CLI migration steps](./README.md#cli-command-migration-unreleased)
when both packages are installed; upgrading the old SDK can remove the MCP
command shim, which must be restored in the same installation prefix.

Run `pnpm run test:tarball` and confirm that the installed `calle-api --help`
lists `calls create`, `calls get`, and `goals run`, while the package manifest
does not export `calle`. Prepare the breaking release in a separate version PR;
merging the implementation does not publish or change the package version.

## Stable release

For a stable release:

1. Set a new, unpublished stable version in `package.json`. Do not reuse a
   version because npm package versions are immutable.
2. Move user-facing entries from `Unreleased` into a versioned section in
   `CHANGELOG.md` when there are entries to release.
3. Merge the version PR to `main` after CI passes.
4. Optionally run `Publish npm package` manually against the intended commit.
   A manual run validates, packs, uploads the checked artifact, and executes
   `npm publish --dry-run`; it cannot publish.
5. Create a `vX.Y.Z` tag at the release commit on `main`, then publish the
   corresponding GitHub Release.

The release workflow rejects prereleases, tags that do not exactly match the
`package.json` version, tag commits that are not contained in `origin/main`,
and versions that do not advance npm's current `latest` version. Before
dependency installation and again immediately before publication, it checks
npm for the exact version. Only an explicit not-found response is treated as
an available version; registry, network, and permission failures stop the
release. Package publication and manual dist-tag changes share one concurrency
lock.

The build job validates and packs once, then uploads exactly one tarball and a
SHA-256 manifest. After environment approval, the publish job downloads that
artifact and rechecks its file set, checksum, package version, and MIT license
before publishing it with the `latest` dist-tag.

## Test API Goal smoke

Before releasing a change to Goal behavior, run the local release candidate
against a published Goal in the test environment:

```bash
export CALLE_API_KEY="<TEST_API_KEY>"
export CALLE_BASE_URL="<APPROVED_TEST_API_BASE_URL>"
export CALLE_GOAL_ID="<PUBLISHED_TEST_GOAL_ID>"
export CALLE_EXAMPLE_PHONE="<AUTHORIZED_TEST_E164_PHONE>"
export CALLE_GOAL_VARIABLES='{"name":"Alex"}'
export CALLE_IDEMPOTENCY_KEY="<UNIQUE_DURABLE_TEST_KEY>"
pnpm run example:goal-run
```

This smoke test creates a real phone call. Use an authorized test number and a
new idempotency key for a new logical test. Reuse the same key only when
retrying that exact request. Record the returned Goal Run id and verify that
exactly one of `result` or `error` is non-null.

## Post-publish verification

The workflow waits for exact-version registry metadata, installs the published
package in a temporary project, imports `CalleClient`, verifies that its
SDK command is `calle-api` without a `calle` alias, and runs the installed
`calle-api --help` to check the Developer API command contract.

A failure in either post-publish check does not mean publication failed. If the
`npm publish` step succeeded, do not retry the same version. Check the registry
state and investigate the verification failure first.

Manual verification:

```bash
VERSION="$(node -p "require('./package.json').version")"
npm view "@call-e/calle@${VERSION}" version dist-tags

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install "@call-e/calle@${VERSION}"
node --input-type=module -e 'import { CalleClient } from "@call-e/calle"; const client = new CalleClient({ apiKey: "smoke" }); console.log(typeof client.goals.runAndWait)'
./node_modules/.bin/calle-api --help
```

## Dist-tags

Use the `Manage npm dist-tags` workflow only when a published version needs an
explicit tag correction. Run it from `main`. `add` requires an exact semantic
version and a validated lowercase tag; `remove` requires a tag; `list` accepts
neither. Mutating actions require the `NPM_TOKEN` repository secret and the
`npm` environment.

The workflow prevents removing `latest`, requires `latest` to target a stable
version, and requires `beta` to target a prerelease version.

## Version rules

- Patch releases fix SDK wrapper bugs, type issues, packaging metadata, README
  examples, or distribution issues without changing public API behavior.
- Minor releases add backward-compatible API fields, endpoints, or SDK helpers.
- Major releases make breaking CLI command name, public API, method signature,
  stable error, or webhook signature contract changes.

Keep TypeScript, Python, OpenAPI, and public docs behavior aligned by default. A
single-language patch is appropriate only when the shared API contract and
cross-language behavior do not change.
