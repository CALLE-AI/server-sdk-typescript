## Summary

Describe the SDK behavior, documentation, or release workflow change.

## Checklist

- [ ] I kept this change within the Phase 1 server SDK scope.
- [ ] I did not add browser/client-side patterns that expose CALL-E API keys.
- [ ] I updated tests, examples, or docs when behavior changed.
- [ ] I ran the relevant local checks.

## Local checks

```bash
pnpm run test
pnpm run typecheck
pnpm run typecheck:examples
pnpm run test:package
pnpm run pack:check
```
