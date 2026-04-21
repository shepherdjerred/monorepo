# Type-safe Home Assistant client

## Summary

`@shepherdjerred/home-assistant` exposes `HomeAssistantRestClient<S>` and `HomeAssistantEventClient<S>` generic over an `HaSchema`. A new bin, `ha-codegen`, introspects a live HA instance (`/api/states`, `/api/services`, `/api/events`, `/api/config`) and emits a TypeScript module with literal unions for entity IDs, services, and event types. Consumer packages (today: `packages/temporal`) parameterize the client with the generated schema and get compile-time rejection of unknown entities, wrong domain/service pairs, cross-domain `entity_id` values, and unknown event types.

Unparameterized clients — `new HomeAssistantRestClient({...})` with no generic — keep the original loose behavior via a `DefaultHaSchema` default, so existing call sites outside temporal are untouched.

## Consumer usage

```ts
import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";
import type { HaSchema } from "./generated/ha-schema.ts";

const ha = new HomeAssistantRestClient<HaSchema>({ baseUrl, token });

await ha.callService("light", "turn_on", {
  entity_id: "light.kitchen",
  brightness: 200,
}); // ✅
await ha.callService("light", "turn_on", { entity_id: "media_player.bedroom" }); // ❌ not a light
await ha.callService("lite", "turn_on", { entity_id: "light.kitchen" }); // ❌ no such domain
await ha.getState("light.kitcen"); // ❌ typo
```

Compile-time assertions live in `packages/home-assistant/test/typed-client.test-d.ts` — 11 `@ts-expect-error` directives exercise the rejection paths.

## Architecture — `packages/temporal`

Three files make the stub/generate/ensure flow work without forcing every developer to have HA credentials:

| Path                              | Committed?      | Role                                                                 |
| --------------------------------- | --------------- | -------------------------------------------------------------------- |
| `src/generated/ha-schema.ts`      | No (gitignored) | Real schema produced by `ha-codegen`; contains sensitive entity IDs. |
| `src/generated/ha-schema.stub.ts` | Yes             | `DefaultHaSchema`-equivalent placeholder. No sensitive content.      |
| `scripts/ensure-ha-schema.ts`     | Yes             | Copies stub into `ha-schema.ts` when the generated file is absent.   |

`package.json` chains `scripts/ensure-ha-schema.ts` in front of `typecheck`, `test`, and `build`, so the import target `src/generated/ha-schema.ts` always exists. `bun run generate` (`bun ../home-assistant/src/codegen/cli.ts --out src/generated/ha-schema.ts --name HaSchema`) overwrites it with the real schema when `HA_URL` + `HA_TOKEN` are in env.

Gitignore rule: `packages/temporal/.gitignore` ignores `src/generated/ha-schema.ts` specifically. The stub and ensure script are normal tracked files.

## Workflow patterns — `packages/temporal/src/workflows/ha/util.ts`

Temporal activities can't be generic (`proxyActivities<HaActivities>` uses `ActivityFunction<P extends any[], R>`, which rejects methods with type parameters — runtime fails with "Type 'Symbol' has no call signatures"). So activities in `src/activities/ha.ts` stay stringly-typed; compile-time narrowing happens in `util.ts` wrappers that the workflows import.

Typed wrappers:

- `callService<D, V>(domain, service, data)` — domain/service/data narrowed against the schema.
- `getEntityState<E>(entityId)` — reshapes the activity return so `entity_id` is the literal E (no `as` cast; re-stamps the field after the activity call, which is consistent with HA returning the entity you asked for).
- `getEntitiesInDomain(domain)` — returns plain `EntityState[]`. **Cannot** narrow the `entity_id` on each result in this monorepo because bridging "runtime string starting with `light.`" into the literal-union `EntityIdByDomain<HaSchema, "light">` requires either a type predicate (banned by `custom-rules/no-type-guards`) or `as` chain (banned by `custom-rules/no-type-assertions`).
- `volumeUpBy(entityId: EntityIdByDomain<HaSchema, "media_player">, ...)` — domain-narrowed.
- `verifyState(entityId: string, ...)` — intentionally accepts plain string because iteration patterns feed it.

Escape hatch for iteration:

- `callServiceUnchecked(domain, service, data)` — plain strings, passes through to the activity. Use when you have a runtime-filtered entity_id from `getEntitiesInDomain` that can't be proved to the type system. See `packages/temporal/src/workflows/ha/leaving-home.ts` for the canonical use.

Entity-ID constants in workflow files must be declared with `as const` so TypeScript preserves the literal type across assignment:

```ts
const BEDROOM_MEDIA = "media_player.bedroom" as const;
const EXTRA_MEDIA_PLAYERS = [MAIN_BATHROOM_MEDIA, ENTRYWAY_MEDIA] as const;
```

Without `as const`, TS widens to `string` and the typed wrappers reject it.

## CI flow

The Buildkite k8s-plugin mounts the `buildkite-ci-secrets` K8s secret on every step via `envFrom` (`scripts/ci/src/lib/k8s-plugin.ts:23-25`), so adding `HASS_URL` and `HASS_TOKEN` to the backing 1Password item makes those env vars available in the temporal step. The `HASS_` prefix matches the CI-secret convention; inside the Dagger container the values get re-bound to `HA_URL` / `HA_TOKEN` (what `ha-codegen` reads).

Pipeline dispatch (`scripts/ci/src/steps/per-package.ts`) special-cases temporal:

- Lint — normal `dagger call lint` (stub is sufficient).
- **Typecheck** — `dagger call generate-and-typecheck-with-secrets --ha-url env:HASS_URL --ha-token env:HASS_TOKEN ...`. Dagger reads those env vars as `Secret`s and injects them into the container as `HA_URL` / `HA_TOKEN` via `withSecretVariable`. `bun run generate` produces the real schema, then `bun run typecheck` runs strictly against it. Typos against the live instance fail CI.
- Test — normal `dagger call test`. Activity tests don't reference the schema and `ensure-ha-schema.ts` drops the stub into place inside the container.

Helper functions: `.dagger/src/typescript.ts` adds `generateContainerWithSecrets` + `generateAndTypecheckWithSecretsHelper`; `.dagger/src/index.ts` adds the corresponding `@func()` wrapper.

## Sensitive-data policy

Per auto-memory `feedback_ha_types_sensitive`: generated HA types contain private entity IDs and service definitions. Never commit `packages/temporal/src/generated/ha-schema.ts`. If regenerated locally, `git checkout` the path before committing, or rely on the gitignore to keep it out of staged changes. Only the `.stub.ts` file and `ensure-ha-schema.ts` script should be tracked.
