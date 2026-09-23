# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-23

### Changed

- Move `client.calls` to the single-target Calls API with required phone, result schema and idempotency key.
- Support optional region/language hints, cancellation before submission, and detailed call events.
- Expose Billing call ID, call outcome, result readiness and recorded transcript turns.
- Stop Calls and Goal Run wait helpers when result readiness is final, including unavailable results with no error.
- This is a breaking Calls migration. Retain SDK 0.7.x for historical legacy call-task IDs; see the public migration guide.
- Clarify webhook configuration, legacy batch-call requirements, and redaction of credentials and private call data.

## [0.7.1] - 2026-09-03

### Added

- MIT license and public contribution, security, and ownership information.
- A public-repository hygiene check for tracked paths, tracked text, and pull
  request metadata.

### Changed

- Stable publishing is initiated by a versioned GitHub Release and uses npm
  Trusted Publishing.
- npm publishing and dist-tag changes are serialized, and stable releases must
  advance the current `latest` version.
- The webhook receiver example bounds request bodies and safely handles
  interrupted uploads.
