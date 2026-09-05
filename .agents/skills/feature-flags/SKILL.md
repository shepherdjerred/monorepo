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
4. Add the Flipt declaration and beta targeting for a new feature. Default it
   off, ramp it, then remove the flag after rollout.
5. Test absence, explicit false/zero, invalid values, source failures, and
   provenance.

Do not make `@shepherdjerred/config` depend on the Flipt client; the flags
package injects the source. Never label metrics by unbounded targeting keys or
log sensitive values. A Flipt evaluation of `false` is an answer, not an outage.

Flipt has no authentication. Network reachability is authorization, so update
its consumer NetworkPolicy when a new workload needs access.
