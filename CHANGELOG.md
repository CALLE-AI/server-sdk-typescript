# Changelog

## Unreleased

- Clarify request-level webhook configuration and purchased-number requirements for batch calls.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Clarify placeholder API keys and redaction of credentials and private call data in SDK documentation.

## [0.7.1] - 2026-09-03

### Added

- MIT license and public contribution, security, and ownership information.
- A public-repository hygiene check for tracked paths, tracked text, and pull
  request metadata.

### Changed

- **Breaking:** Rename the SDK executable from `calle` to `calle-api` and remove
  the old bin entry so it no longer collides with `@call-e/cli`. Update shell
  scripts to use `calle-api`; the `@call-e/calle` package name, imports, and SDK
  methods are unchanged. When upgrading an installation that also contains
  `@call-e/cli`, rebuild its `calle` entry as described in the README.
- Stable publishing is initiated by a versioned GitHub Release and uses npm
  Trusted Publishing.
- npm publishing and dist-tag changes are serialized, and stable releases must
  advance the current `latest` version.
- The webhook receiver example bounds request bodies and safely handles
  interrupted uploads.
