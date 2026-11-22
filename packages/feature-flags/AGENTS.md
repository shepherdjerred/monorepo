# Feature-flag constraints

This package is the OpenFeature adapter for `@shepherdjerred/config` backed by
the first-party `@shepherdjerred/flags` service. Load the repository
`feature-flags` skill for rollout procedure.

- Hosted workloads bootstrap with `FEATURE_FLAGS_MODE=flags`, `FLAGS_URL`, and
  `FLAGS_DEPLOYMENT` (`<catalog>/<stage>`). Missing or malformed bootstrap
  values fail at startup.
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
- In-cluster Flags evaluation (`7361`) is credentialless, rejects
  `Authorization` headers, and is protected by NetworkPolicy. New consumers
  require an intentional `CONSUMER_NAMESPACES` change in
  `packages/homelab/src/cdk8s/src/resources/flags/index.ts`. Management writes
  (`7360`) require verified Tailscale operator identity or the brokered
  `FLAGS_MACHINE_TOKEN` (`flags-auth` in 1Password); never place management
  credentials in runtime consumer configuration.
- New features default on in production and beta, with code defaults,
  `src/managed-flag-inventory.json` declarations, and `src/deployments.ts`
  projections aligned. A temporary default-off exception requires a concrete
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
