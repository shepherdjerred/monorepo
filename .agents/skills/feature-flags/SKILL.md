---
name: feature-flags
description: Add or change typed configuration, environment variables, Flipt flags, targeting, defaults, or rollout behavior in this monorepo. Use whenever application behavior becomes configurable or gated.
---

# Feature flags and configuration

First-party applications use environment variables only for credentials and
bootstrap. Other behavior is a feature flag resolved by
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
   sensitivity, and targeting.
4. New features default on in production and beta. Keep the code default and
   Flipt declarations aligned, including environment overrides. Use flags to
   disable a feature when needed. A temporary default-off exception requires a
   concrete blocker and tracked follow-up with enablement criteria. Missing
   declared keys are created in live Flipt automatically; existing targeting
   needs an explicit rollout change.
5. Test absence, explicit false/zero, invalid values, source failures, and
   provenance.

Delivery includes verifying the feature is enabled in the intended live
environment and exercising its user-visible behavior. A merge behind a disabled
flag is incomplete unless the default-off exception is recorded.

Do not make `@shepherdjerred/config` depend on the Flipt client; the flags
package injects the source. Never label metrics by unbounded targeting keys or
log sensitive values. A Flipt evaluation of `false` is an answer, not an outage.

Flipt evaluation and operator management use different access paths. Keep
consumer NetworkPolicies aligned with evaluation access. Management writes
require the existing 1Password-backed operator credential; follow the flag
inventory operator how-to and never put credentials in consumer configuration.
