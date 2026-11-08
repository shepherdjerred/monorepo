# Feature flags

The OpenFeature/Flipt adapter supplies typed runtime behavior to
`@shepherdjerred/config`. Credentials and provider bootstrap remain environment
configuration. See [FLAG-INVENTORY.md](FLAG-INVENTORY.md) for the contract boundary.

`initFeatureFlags` initializes one provider per process. `isEnabled` evaluates
booleans with explicit targeting; a successful `false` remains authoritative.
`createFlagConfigSource` injects evaluations into configuration resolution.
Provider outages may use declared defaults. Missing keys and malformed values
fail loudly.

`managedBooleanDefault(key, environment)` reads the effective inventory default
for consumer outage behavior. The default environment is production; consumers
with beta deployments pass their actual Flipt environment explicitly.

`createFlagMetricSet` registers the shared metric families through factories
that close over the application's client and registry; the library owns neither.
`createFlagMetricsRecorder` adapts those metrics. Evaluation values
are bounded to `true`, `false`, `non_boolean`, and `error`. Variant values and
targeting identifiers are never labels. `feature_flag_provider_info` identifies
the configured Flipt pair and is cleared at shutdown.

The inventory schema validates exception metadata and rejects obsolete
exceptions. `defaultOnPolicyViolations` enforces coverage for every environment
in CI. Review expiry is monitored rather than making runtime parsing depend on
the wall clock. `classifySnapshotBoolean` preserves rule order and proves
constant outcomes conservatively.

Operator management is separate from credentialless evaluation. The
[inventory how-to](../docs/wiki/src/content/docs/how-to/check-flipt-flag-inventory.md)
covers missing-key reconciliation and explicit declared rollout writes.

```bash
bun run generate
bun run build
bun run typecheck
bun run test
bun run lint
```
