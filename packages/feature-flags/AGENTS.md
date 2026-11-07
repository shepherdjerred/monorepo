# Feature-flag constraints

This package is the OpenFeature/Flipt adapter for `@shepherdjerred/config`.
Load the repository `feature-flags` skill for rollout procedure.

- A missing flag (`FLAG_NOT_FOUND`) on an active provider is an error and fails
  loudly (`FlagNotFoundError`). Transport outages or disabled mode
  (`PROVIDER_NOT_READY`) degrade to lower configuration layers.
- A successful `false` is an answer and must never fall through.
- Malformed successful values fail loudly.
- Keep the dependency direction from this package to `config`, never the
  reverse.
- Initialize one client per process and close it during shutdown. Do not create
  a client per request.
- Targeting context is typed and explicit. Never use guild, user, or entity IDs
  as metric labels.
- Flipt evaluation is credentialless and protected by NetworkPolicy. New
  consumers require an intentional homelab NetworkPolicy change. Management
  writes require the existing 1Password-backed operator credential; never
  place that credential in runtime consumer configuration.
- New features default on in production and beta, with code defaults and Flipt
  declarations aligned. A temporary default-off exception requires a concrete
  blocker and tracked follow-up with enablement criteria. Follow the
  `feature-flags` skill through live enablement and behavior verification.

Tests must cover absence, explicit false/zero, malformed values, evaluation
errors, targeting, change observation, and shutdown.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
