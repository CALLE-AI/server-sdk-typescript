# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
