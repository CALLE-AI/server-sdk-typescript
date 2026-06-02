# Security

## Supported versions

The SDK is in Phase 1 beta preparation. Security fixes are applied to the
current beta line.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities. Use GitHub private
vulnerability reporting if it is enabled for this repository; otherwise contact
the CALL-E maintainers directly.

Send a private report to the CALL-E maintainers with:

- Affected package and version.
- Reproduction steps or proof of concept.
- Expected impact.
- Any relevant logs with secrets removed.

## Secret handling

This SDK is for trusted server environments only. Do not expose CALL-E API keys
or webhook secrets in browser code, mobile apps, public logs, or client-side
bundles.

Webhook handlers must verify `CALL-E-Timestamp` and `CALL-E-Signature` against
the raw request body before parsing or trusting an event.
