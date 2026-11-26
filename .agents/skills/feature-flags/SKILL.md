---
name: feature-flags
description: Add or change typed configuration, environment variables, feature flags, targeting, defaults, or rollout behavior in this monorepo. Use whenever application behavior becomes configurable or gated.
---

# Feature flags and configuration

First-party applications use environment variables only for credentials and
bootstrap (`FEATURE_FLAGS_MODE=flags`, `FLAGS_URL`, and `FLAGS_DEPLOYMENT` as
`<catalog>/<stage>`). Other runtime behavior is a feature flag served by the
first-party `@shepherdjerred/flags` service and resolved by
`@shepherdjerred/config` and `@shepherdjerred/feature-flags`.

Resolution is `flag -> env -> file -> default`. Fall through only on absence:
`false`, `0`, and other resolved values stop the chain. A failing source is
observed and may fall through; a present invalid value throws. Empty environment
strings are absent.

Before adding a key:

1. Find the existing read site and determine whether it is per-call,
   session-scoped, or boot-wired.
2. Classify credentials/bootstrap versus behavior.
3. Define a Zod schema, safe production-compatible default, allowed sources,
   sensitivity, and targeting. A variant flag's value schema lives in the
   registry `packages/feature-flags/src/flag-value-schemas.ts` (encoding plus
   decoded Zod schema, no transforms), never only in the consumer: add the
   entry, run `bun run generate` in `packages/feature-flags`, and have the
   consumer use `schema: flagValueSchema(key)` with
   `kinds: { ...: flagValueKind(key) }`. The Flags server rejects writes that
   fail the registry.
4. New features default on in production and beta. Keep the code default,
   `packages/feature-flags/src/managed-flag-inventory.json` declarations, and
   active deployment projections (`packages/feature-flags/src/deployments.ts`)
   aligned, including environment overrides. Use flags to disable a feature
   when needed. A temporary default-off exception requires a concrete blocker
   and tracked follow-up with enablement criteria. Missing declared keys are
   created in live Flags deployments automatically; existing targeting needs an
   explicit revision-checked rollout change via `toolkit flags` or
   `bun run check-flag-inventory`.
5. Test absence, explicit false/zero, invalid values, source failures, and
   provenance.

Delivery includes verifying the feature is enabled in the intended live
deployment (`toolkit flags get <deployment> <flag>` or the Flags UI at
`https://flags.tailnet-1a49.ts.net`) and exercising its user-visible behavior.
A merge behind a disabled flag is incomplete unless the default-off exception
is recorded.

Do not make `@shepherdjerred/config` depend on the Flags provider;
`@shepherdjerred/feature-flags` injects the source. Never label metrics by
unbounded targeting keys or log sensitive values. A flag evaluation of `false`
is an answer, not an outage.

Flags evaluation (port `7361` in-cluster: `/v1/deployments/:catalog/:stage/snapshot`
and `/v1/evaluate`) and management (port `7360`) use separate listeners and
NetworkPolicy ports. Evaluation is credentialless and rejects `Authorization`
headers. Management writes require verified Tailscale operator identity or the
brokered `FLAGS_MACHINE_TOKEN` (`flags-auth` in 1Password, resolved via
`toolkit flags --machine` or `toolkit run --env FLAGS_MACHINE_TOKEN`); follow
the [flag inventory operator how-to](../../packages/docs/wiki/src/content/docs/how-to/check-flag-inventory.md)
and never put management credentials in consumer configuration.
