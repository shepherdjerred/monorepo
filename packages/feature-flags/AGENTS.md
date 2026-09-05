# Feature-flag constraints

This package is the OpenFeature/Flipt adapter for `@shepherdjerred/config`.
Load the repository `feature-flags` skill for rollout procedure.

- Flipt absence or an evaluation failure means no answer; the layered resolver
  may continue. A successful `false` is an answer and must never fall through.
- Preserve the two failure classes: transport/evaluation failures degrade to
  lower configuration layers, while malformed successful values fail loudly.
- Keep the dependency direction from this package to `config`, never the
  reverse.
- Initialize one client per process and close it during shutdown. Do not create
  a client per request.
- Targeting context is typed and explicit. Never use guild, user, or entity IDs
  as metric labels.
- Flipt has no authentication; reachability is authorization. New consumers
  require an intentional homelab NetworkPolicy change.
- A new behavior flag defaults off, is enabled in beta, ramps deliberately, and
  is removed after rollout. Defaults continue to represent safe production
  behavior during a Flipt outage.

Tests must cover absence, explicit false/zero, malformed values, evaluation
errors, targeting, change observation, and shutdown.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
