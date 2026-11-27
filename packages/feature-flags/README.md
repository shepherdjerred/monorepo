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
configured deployment and is cleared at shutdown.

The inventory schema validates exception metadata and rejects obsolete
exceptions. `defaultOnPolicyViolations` enforces coverage for every environment
in CI. Review expiry is monitored rather than making runtime parsing depend on
the wall clock. `classifyFlagBoolean` and `classifyManagedBoolean` preserve rule
order and prove constant outcomes conservatively.

Operator management (`7360`, via `https://flags.tailnet-1a49.ts.net` or
`toolkit flags`) is isolated from credentialless evaluation (`7361`). The
[inventory how-to](../docs/wiki/src/content/docs/how-to/check-flag-inventory.md)
covers the operator UI, `toolkit flags`, missing-key reconciliation, and
revision-checked declared rollout writes.
Machine callers share `FLAGS_MACHINE_TOKEN`, so
`createFlagsMachineFetcher(url, token, fetch, { actor })` also sends a stable
advisory `X-Flags-Actor` label (`temporal-flag-inventory-sync`,
`check-flag-inventory`) that the Flags audit trail records; it is not a
credential.

## Variant value schemas

Every variant flag stores one string, but each key has a real type.
`src/flag-value-schemas.ts` is the single source of truth: `flagValueSchemas`
maps every `ManagedVariantFlagKey` (a missing or extra key is a compile error)
to a wire encoding and a Zod schema for the decoded value:

| Encoding | Wire string                 | Decoded value        | Helper             |
| -------- | --------------------------- | -------------------- | ------------------ |
| `string` | the value                   | string (enum, regex) | `variantString(s)` |
| `number` | JSON number literal (`900`) | number               | `variantNumber(s)` |
| `json`   | JSON text (`[]`, `{...}`)   | array or object      | `variantJson(s)`   |

Decoded schemas carry no transforms so they export as JSON Schema; object
fields may use `.default()`. Consumers keep reading through
`createFlagConfigSource` and use the registry in their definitions:

```ts
enabledEnvironments: {
  schema: flagValueSchema("delivery-enabled-environments"),
  sources: ["flag", "default"],
  default: "[]",
  names: { flag: "delivery-enabled-environments" },
},
// kinds: { enabledEnvironments: flagValueKind("delivery-enabled-environments") }
```

`flagValueSchema(key)` accepts what config layers hand a key today (the string
for `string` keys; a number or decimal string for `number` keys; JSON text or an
already-decoded value for `json` keys) and outputs the validated decoded value.
Consumer-only post-processing, such as splitting a comma-separated list or
mapping `disabled` to an empty channel, stays in the consumer as a `.transform`
after it. `decodeVariantValue`, `encodeVariantValue` (canonical: `String` for
numbers, compact `JSON.stringify` for JSON), and `validateVariantValue` (issues
with JSON Pointer paths) serve tools and the Flags server, which rejects invalid
writes (`flag-write-validation.ts`) and reports invalid live values in drift.

Each entry mirrors the consumer schema that reads the key. Where the registry is
stricter than a consumer, the difference is deliberate: model ids have no
whitespace and at most 200 characters; Discord ids are 1-25 digits; comma lists
(`explore-guild-allowlist`, `streambot-subtitle-languages`, Home Assistant
entities, Photon owners) have no empty entries and no padding except a space
after a comma; JSON settings objects reject unknown keys and coerced numeric
strings; stored strings carry no surrounding whitespace where consumers trimmed.
`storm-forum-season` lists the `@shepherdjerred/storm-theme` catalog ids,
guarded by a storm-forum test.

Model-id keys use `modelIdFor(route)`: `ModelIdSchema` tagged in its JSON
Schema with `x-model-route`, the `@shepherdjerred/llm-models` route the
consumer resolves (`{ kind: "native", endpoint, requires? }`, `codexSdk`, or
`claudeAgentSdk`). The tag does not change what parses, and this package does
not depend on the model catalog; the Flags editor reads the tag to offer the
catalog models that route. Set the route from the consumer's call site when
adding a model-id key.

`bun run generate` also writes `src/flag-value-schemas.generated.json`
(`{ [key]: { encoding, schema } }`, JSON Schema draft 2020-12 of the decoded
input) for editors. Tests fail when either generated file is stale. When adding
a variant flag, add its registry entry, regenerate, and make sure its inventory
default and overrides decode.

```bash
bun run generate
bun run build
bun run typecheck
bun run test
bun run lint
```
