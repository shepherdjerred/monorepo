# Feature flags

The OpenFeature adapter for the first-party `@shepherdjerred/flags` service
supplies typed runtime behavior to `@shepherdjerred/config`. Credentials and
provider bootstrap (`FEATURE_FLAGS_MODE=flags`, `FLAGS_URL`, and
`FLAGS_DEPLOYMENT` as `<catalog>/<stage>`) remain environment configuration.
See [FLAG-INVENTORY.md](FLAG-INVENTORY.md) for the contract boundary.

`initFeatureFlags` initializes one provider per process. `isEnabled`,
`stringValue`, and `numberValue` evaluate flags with explicit targeting; a
successful `false` remains authoritative. `createFlagConfigSource` injects
evaluations into configuration resolution. Provider outages may use declared
defaults. Missing keys and malformed values fail loudly.

`managedBooleanDefault(key, environment)` reads the effective inventory default
for consumer outage behavior. The default environment is production; consumers
with `beta` deployments pass their stage environment explicitly.
`projectDeploymentFlags(deployment)` projects a workload's active deployment
document (`src/deployments.ts`) from `src/managed-flag-inventory.json`.

`createFlagMetricSet` registers the shared metric families through factories
that close over the application's client and registry; the library owns neither.
`createFlagMetricsRecorder` adapts those metrics. Evaluation values are bounded
to `true`, `false`, `non_boolean`, and `error`. Variant values and targeting
identifiers are never labels. `feature_flag_provider_info` identifies the
configured deployment's catalog and stage and is cleared at shutdown.

The inventory schema validates exception metadata and rejects obsolete
exceptions. `defaultOnPolicyViolations` enforces coverage for every environment
in CI. Review expiry is monitored rather than making runtime parsing depend on
the wall clock. `classifyFlagBoolean` and `classifyManagedBoolean` preserve rule
order and prove constant outcomes conservatively.

Operator management (`7360`, via `https://flags.tailnet-1a49.ts.net` or
`toolkit flags`) is isolated from credentialless evaluation (`7361`). The
[inventory how-to](../docs/wiki/src/content/docs/how-to/check-flipt-flag-inventory.md)
covers the operator UI, `toolkit flags`, missing-key reconciliation, and
revision-checked declared rollout writes.

```bash
bun run generate
bun run build
bun run typecheck
bun run test
bun run lint
```
