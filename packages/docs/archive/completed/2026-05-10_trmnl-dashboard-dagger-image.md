---
id: reference-completed-2026-05-10-trmnl-dashboard-dagger-image
type: reference
status: complete
board: false
---

# trmnl-dashboard — build via Dagger, no Dockerfile

## Context

The `trmnl-dashboard` workload in the homelab cluster has been crash-looping because the published image (`ghcr.io/shepherdjerred/trmnl-dashboard:latest`) is just a re-tagged `oven/bun` base image — no app source, no non-root user, no real entrypoint to anything in `packages/trmnl-dashboard`. The package was never wired into the monorepo's Dagger image-build pipeline.

This session already unblocked two earlier failures:

1. **GHCR package was private** → flipped to public; image now pulls.
2. **Secret key mismatch** — 1Password item had legacy `<SERVICE>`+`_API_`+`TOKEN` field names; cdk8s referenced `BUGSINK_TOKEN`/`PAGERDUTY_TOKEN`. Renamed the 1Password fields to the `<SERVICE>_TOKEN` form (matches the pre-commit `env-var-names` canonical); the connect operator resynced.

The remaining failure is `CreateContainerConfigError: container has runAsNonRoot and image will run as root`. The cdk8s-plus-31 default sets `runAsNonRoot: true` on every pod; the published image's `Config.User` is empty.

**Goal**: build the image properly with the monorepo's Dagger pipeline (no Dockerfile per user request — keep all build logic in TypeScript), set a numeric non-root user so the existing pod security context works as-is, push to GHCR, and pin the chart to the resulting digest.

## Approach

Two-step ship:

- **PR #1 — wire the build.** Add Dagger helpers, expose them as module functions, register in CI catalog, add a smoke test. CI on main builds and pushes the first real image.
- **PR #2 — pin the chart.** After CI publishes, bump `versions.ts` to the new `@sha256:` digest with a Renovate annotation; ArgoCD syncs and the pod becomes healthy.

The Dagger helpers mirror the simplest existing precedent (`buildDiscordPlaysPokemonImageHelper` at `.dagger/src/image.ts:667`) since trmnl-dashboard is a plain Bun service with no Prisma, no codegen, no persistent state. The one deliberate departure: append `.withUser("1000:1000")` so kubelet can validate non-root from the image config alone (no chart-side `ensureNonRoot: false` workaround needed).

## PR #1 — Build wiring

### File: `.dagger/src/image.ts`

Add `buildTrmnlDashboardImageHelper(pkgDir, depNames, depDirs, version, gitSha)`:

- Base: `BUN_IMAGE` (currently `oven/bun:1.3.13`, pinned in `.dagger/src/constants.ts:13`).
- Mount cache: `withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))`.
- Mount source: `withDirectory("/workspace/packages/trmnl-dashboard", pkgDir, { exclude: ["node_modules", "dist", ".eslintcache"] })`.
- Loop `depNames`/`depDirs` and mount each at `/workspace/packages/<name>` with the same excludes (will receive `eslint-config` + `home-assistant` per `.dagger/src/deps.ts:27`).
- `withWorkdir("/workspace/packages/trmnl-dashboard")` → `withExec(["bun", "install", "--frozen-lockfile"])`.
- Standard `VERSION` / `GIT_SHA` env vars + OCI labels (mirror temporal-worker lines 570–577).
- `.withUser("1000:1000")` — the only material departure from the existing helpers.
- `.withEntrypoint(["bun", "run", "src/index.ts"])`.

Add `pushTrmnlDashboardImageHelper(...)` mirroring `pushDiscordPlaysPokemonImageHelper` (`.dagger/src/image.ts:740`); it composes the build helper then calls the existing `pushContainerHelper(image, tags, registryUsername, registryPassword)` (line 403).

### File: `.dagger/src/misc.ts`

Add `smokeTestTrmnlDashboardHelper(pkgDir, depNames, depDirs)` mirroring `smokeTestStarlightKarmaBotHelper` (line 251):

- Build the image, then override entrypoint to inject dummy required env vars before starting Bun:
  - `TRMNL_API_KEY=smoke-test-dummy`
  - `HA_TOKEN=smoke-test-dummy`
  - `HA_URL=http://127.0.0.1:9999` (a value the HA client will reject quickly).
- `withExec(["sh", "-c", "timeout 15s bun run src/index.ts 2>&1 || true"])` — accept an exit since HA is unreachable; we just need to confirm Zod config parsing passed and the server initialized.
- `runSmokeTest(container, ["Listening", "3000", "TRMNL"])` — assert one of these markers appears, signaling boot reached `Bun.serve` (`packages/trmnl-dashboard/src/index.ts:8`).

Required env vars come from `packages/trmnl-dashboard/src/config.ts` Zod schema (lines 31–66, identified during exploration).

### File: `.dagger/src/index.ts`

Expose three new `@func()` methods following the existing pattern (e.g. `buildScoutImage` line ~420, `pushScoutImage` line ~431, `smokeTestStarlightKarmaBot` line 1167):

- `buildTrmnlDashboardImage(pkgDir, depNames=[], depDirs=[], version="dev", gitSha="unknown"): Container`
- `pushTrmnlDashboardImage(pkgDir, tags, registryUsername, registryPassword, depNames=[], depDirs=[], version="dev", gitSha="unknown"): Promise<string>` — annotate `@func({ cache: "never" })`.
- `smokeTestTrmnlDashboard(pkgDir, depNames=[], depDirs=[]): Promise<string>`.

Add the three helper imports to the existing import blocks at the top.

### File: `scripts/ci/src/catalog.ts`

Replace the existing entry on line 51:

```ts
{ name: "trmnl-dashboard", versionKey: "shepherdjerred/trmnl-dashboard" },
```

with:

```ts
{
  name: "trmnl-dashboard",
  versionKey: "shepherdjerred/trmnl-dashboard",
  buildFn: "build-trmnl-dashboard-image",
  pushFn: "push-trmnl-dashboard-image",
},
```

### File: `scripts/ci/src/steps/images.ts`

Add to the `SMOKE_TEST_FUNCTIONS` map (around line 105):

```ts
"trmnl-dashboard": "smoke-test-trmnl-dashboard",
```

This makes `pushImagesGroup` depend on the smoke step (line 298–301) instead of the raw build step.

## PR #2 — Pin to published digest

After PR #1 merges and the main-branch pipeline publishes the new image, capture the digest from the Buildkite log (or `gh api /users/shepherdjerred/packages/container/trmnl-dashboard/versions`).

### File: `packages/homelab/src/cdk8s/src/versions.ts`

Replace the existing `shepherdjerred/trmnl-dashboard` entry (currently around line 237 — flagged "not managed by renovate") with the digest from PR #1's publish, plus the standard Renovate annotation pattern used by `starlight-karma-bot` (line 109):

```ts
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/trmnl-dashboard
"shepherdjerred/trmnl-dashboard":
  "<new-tag>@sha256:<new-digest>",
```

ArgoCD will reconcile the chart on next sync.

## Out of scope (intentionally)

- **`DEPLOY_TARGETS` entry in catalog.ts** — only adds deployment orchestration metadata; not required for the workload to run via ArgoCD's existing `Application` resource.
- **Adding a writable `/tmp` `emptyDir` volume** — config inspection shows zero filesystem writes; defer until a concrete need surfaces.
- **Touching the cdk8s chart** — `runAsNonRoot: true` and `readOnlyRootFilesystem: true` are correct defaults; the image fix is the right layer to address the `runAsNonRoot` failure.

## Files touched

| PR  | File                                              | Change                                                              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `.dagger/src/image.ts`                            | + `buildTrmnlDashboardImageHelper`, `pushTrmnlDashboardImageHelper` |
| 1   | `.dagger/src/misc.ts`                             | + `smokeTestTrmnlDashboardHelper`                                   |
| 1   | `.dagger/src/index.ts`                            | + 3 `@func()` exports + imports                                     |
| 1   | `scripts/ci/src/catalog.ts:51`                    | wire `buildFn`/`pushFn` on the existing entry                       |
| 1   | `scripts/ci/src/steps/images.ts` (~line 105)      | + `SMOKE_TEST_FUNCTIONS["trmnl-dashboard"]`                         |
| 2   | `packages/homelab/src/cdk8s/src/versions.ts:~237` | bump to `<tag>@sha256:<digest>` + Renovate annotation               |

## Verification

PR #1 (locally before push):

1. `cd .dagger && bun run typecheck` — module compiles.
2. `cd scripts/ci && bun run typecheck && bun test` — pipeline generator types/tests pass.
3. `dagger develop && dagger functions | grep trmnl-dashboard` — three new functions appear.
4. `dagger call build-trmnl-dashboard-image --pkg-dir ./packages/trmnl-dashboard --dep-names eslint-config,home-assistant --dep-dirs ./packages/eslint-config,./packages/home-assistant` — image builds locally.
5. `dagger call smoke-test-trmnl-dashboard --pkg-dir ./packages/trmnl-dashboard --dep-names eslint-config,home-assistant --dep-dirs ./packages/eslint-config,./packages/home-assistant` — smoke test passes.

PR #1 (after merge):

6. Buildkite main-branch pipeline runs `build-trmnl-dashboard-image` → `smoke-test-trmnl-dashboard` → `push-trmnl-dashboard-image`. Capture the published digest from the `push-` step's stdout.

PR #2 (after merge):

7. `kubectl -n trmnl-dashboard get application trmnl-dashboard -o jsonpath='{.status.sync.status} {.status.health.status}'` → `Synced Healthy` after Argo sync.
8. `kubectl -n trmnl-dashboard get pod -l app=trmnl-dashboard` → `1/1 Running`, no restarts.
9. `kubectl -n trmnl-dashboard exec deploy/trmnl-dashboard -- wget -qO- http://localhost:3000/livez` → `ok`.
10. End-to-end: `curl -fsS https://trmnl.sjer.red/livez` → `ok` (cloudflare tunnel binding at `index.ts:148`).

## Reused — do not reinvent

- `buildImageHelper` / `pushContainerHelper` (`.dagger/src/image.ts:307`, `:403`) — generic build/push primitives.
- `BUN_IMAGE`, `BUN_CACHE` (`.dagger/src/constants.ts:13`) — pinned base + cache name.
- `runSmokeTest` (`.dagger/src/misc.ts`) — log-pattern matcher used by every other smoke helper.
- `withCommonProps` already wraps the cdk8s container (`packages/homelab/src/cdk8s/src/resources/trmnl-dashboard/index.ts:79`); no change needed there.
- `deps.ts:27` already declares `"trmnl-dashboard": ["eslint-config", "home-assistant"]` — the CI generator will pass them through.
