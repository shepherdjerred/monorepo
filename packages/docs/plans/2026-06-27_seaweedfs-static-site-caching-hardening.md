# Plan: fix static-site caching gaps (SeaweedFS / Caddy / Cloudflare)

## Status

In Progress — all phases implemented and pushed to PR #1328 (`fix/seaweedfs-asset-loading`); pending CI + merge.

## Context

PR #1328 fixed the user-visible asset-load failures (in-cluster S3 endpoint + immutable headers on hashed assets) but is still open, and a deep-research review plus live probing surfaced gaps in the **mutable tier**, **deploy safety**, and **edge caching**. This addresses them across all SeaweedFS static sites in one coherent PR. (Research report: `~/.claude-extra/research/caching-static-sites-seaweedfs-caddy-cloudflare.md`.)

### What live experiments proved (do NOT "fix" these — already fine)

Probing `scout-for-lol.com` on 2026-06-27 (PR #1328 still unmerged):

- **Trap (b) — conditional-refresh 403 — is already fixed.** The `caddy-s3-proxy` fork pins `shepherdjerred/caddy-s3-proxy@v0.5.7-head2`, whose changelog includes the "304-on-index fix" (`.dagger/src/constants.ts:45-51`). Live `GET /app/index.html` with `If-Modified-Since` → `304`, not `403`. So `no-cache` + revalidation on the shell is safe.
- **Missing assets return a real `404`, not a 200-HTML poison.** `errors 404 <key>` serves the key's body but **preserves the 404 status** (`s3-static-site.ts:192-199`). Live `GET /app/assets/deadbeef.js` → `404`. So the "200-HTML defeats `vite:preloadError`" and "immutable-poison-for-a-year" backfires from the generic research **do not apply** here — and object-metadata keeps it that way (the 404 carries `index.html`'s own `no-cache`, never `immutable`).

### Live-confirmed gaps

| #   | Gap                                                                                                            | Fix                                                                                                  | Files                                                                                                          | Priority |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Hashed assets get only CF default `max-age=14400` (4h), `cf-cache-status: MISS` every request — no `immutable` | `Cache-Control` as **S3 object metadata** at upload                                                  | `.dagger/src/release.ts`, `scripts/ci/src/catalog.ts`, `scripts/ci/src/steps/sites.ts`, `.dagger/src/index.ts` | P0       |
| 2   | `aws s3 sync … --delete` prunes every old hash each deploy → open tabs chunk-error                             | Stop `--delete` on hashed prefixes; prune by **age** via SeaweedFS lifecycle                         | `.dagger/src/release.ts`, `packages/homelab/src/tofu/seaweedfs/buckets.tf`                                     | P0       |
| 3   | Assets not reliably edge-cached; `immutable` may not reach browsers                                            | CF: Browser Cache TTL = Respect Existing Headers, cache rule for hashed prefixes, Smart Tiered Cache | `packages/homelab/src/tofu/cloudflare/*.tf`                                                                    | P1       |
| 4   | #1328's Caddy `@immutableAssets` matcher would stamp `immutable` on the 404/fallback response                  | Drop the matcher; caching comes from object metadata (passed through by caddy-s3-proxy)              | `s3-static-site.ts`, `sites.ts`, `s3-static-site.test.ts`                                                      | P0       |
| 5   | No `vite:preloadError` handler → pruned lazy chunk (Monaco) hangs `<Suspense>`                                 | Reload-once handler (sessionStorage-guarded)                                                         | `packages/scout-for-lol/packages/app/src/main.tsx`                                                             | P2       |
| 6   | _(optional)_ missing `/app/assets/*` serves `index.html` body w/ 404 status                                    | Split `/app/assets/*` to a real 404; seed `404.html`                                                 | `s3-static-site.ts`, `buckets.tf`                                                                              | P3       |

Keep PR #1328's in-cluster `S3_ENDPOINT` change (trap-(a) fix).

## Changes

### 1 + 4 — Object-metadata Cache-Control, drop the Caddy matcher (P0)

**Deploy helper (`.dagger/src/release.ts`):** replace the single `aws s3 sync … --delete` with a 2-pass sync driven by a new `immutablePrefixes: string[]` param (default `["_astro/"]`):

- Pass 1 (hashed → immutable, no delete): `aws s3 sync <dist> s3://<bucket>/ --endpoint-url <ep> --exclude "*" --include "<p>/*"… --cache-control "public, max-age=31536000, immutable"`
- Pass 2 (rest → no-cache, with delete): `aws s3 sync <dist> s3://<bucket>/ --endpoint-url <ep> --exclude "<p>/*"… --cache-control "no-cache" --delete` (excluded keys are exempt from `--delete`, so old hashed assets survive for the lifecycle rule).
- Update the dryrun branch to echo both passes.

Thread `immutablePrefixes` catalog.ts → steps/sites.ts → index.ts `deploySite` → `deploySiteHelper`. Per-site: Astro `["_astro/"]` (default), scout `["_astro/", "app/assets/"]`, Vite (better-skill-capped, clauderon) `["assets/"]`, no-hash sites `[]`.

**cdk8s:** remove `immutableAssetPaths`/`DEFAULT_IMMUTABLE_ASSET_PATHS`/`IMMUTABLE_CACHE_CONTROL`/`renderImmutableAssetBlock` + tests; keep the `S3_ENDPOINT` change. caddy-s3-proxy passes through object `Cache-Control`.

Migration: `aws s3 sync` compares size/mtime not metadata; new hashed filenames get it next deploy, `index.html` too; old objects fall back to CF default until lifecycle prunes them.

### 2 — SeaweedFS lifecycle pruning (P0)

`buckets.tf`: `terraform_data` lifecycle per static-site bucket (one rule per hashed prefix, `Expiration.Days = 90`), following `public_sjer_red_lifecycle` (endpoint `https://seaweedfs-s3.tailnet-1a49.ts.net`). scout-frontend/beta → `app/assets/` + `_astro/`; sjer-red/cook/stocks/ts-mc → `_astro/`; better-skill-capped/clauderon → `assets/`. Skip resume/webring/glitter.

### 3 — Cloudflare cache config (P1)

Factor a reusable local module under `tofu/cloudflare/modules/static-cache/`: `cloudflare_zone_setting browser_cache_ttl=0` (Respect Existing Headers), a `cloudflare_ruleset` (cache phase) matching hashed prefixes (eligible, edge/browser TTL = respect origin, serve-stale-while-revalidating), and Smart Tiered Cache. Verify v5 provider schemas. Apply per static-site zone.

### 5 — vite:preloadError recovery (P2)

`main.tsx`: `window.addEventListener("vite:preloadError", …)` → reload once, guarded by a `sessionStorage` flag cleared on successful load.

### 6 — optional SPA-asset 404 polish (P3)

`/app/assets/*` `handle` with `errors 404 404.html` before the `/app/*` fallback; seed a `404.html` per bucket (mirror `public_sjer_red_seed`). Low value given object metadata already gives the 404 `no-cache`.

## Verification

- cdk8s: `cd packages/homelab/src/cdk8s && bun run test`; `dagger call caddyfile-validate --source=.`.
- root `bun run typecheck`; `cd scripts/ci && bun test`; `dagger call deploy-site … --dryrun` (confirm 2-pass).
- tofu: `tofu … validate` with `-backend=false`; real plan/apply via `op run`.
- scout app: `bun run --filter='./packages/scout-for-lol' typecheck`.
- Post-deploy curls: hashed asset → immutable + warm `cf-cache-status: HIT`; shell → `no-cache` + conditional `304`; missing asset → `404`; `aws s3api get-bucket-lifecycle-configuration` shows the rules.

## Out of scope

- Upstream SeaweedFS SigV4 root cause; caddy-s3-proxy retry-on-403.
- Deploy-time sync endpoint off the Cloudflare hairpin.
- API-route caching (tRPC `no-store`/`private`; anonymous-GET `s-maxage`+SWR).

## Session Log — 2026-06-27

### Done

- **cdk8s** (`40af57e3c`): removed #1328's `@immutableAssets` Caddy path-matcher (`immutableAssetPaths`/`DEFAULT_IMMUTABLE_ASSET_PATHS`/`IMMUTABLE_CACHE_CONTROL`/`renderImmutableAssetBlock` + tests) from `s3-static-site.ts`/`sites.ts`; kept the in-cluster `S3_ENDPOINT`. 31 unit tests pass.
- **Deploy 2-pass sync** (`b0bba7f06`): new `s3SyncStaticSite` in `.dagger/src/release.ts` (pass 1 hashed→immutable no-delete, pass 2 rest→no-cache+delete); `immutablePrefixes` threaded through `catalog.ts` → `steps/sites.ts` → `index.ts` → helper. Verified generated deploy commands per site (scout `_astro/ app/assets/`, bsc `assets/`, others default `_astro/`).
- **SeaweedFS lifecycle** (`c28710843`): `terraform_data.static_site_asset_lifecycle` (for_each, 90d, per hashed prefix) in `tofu/seaweedfs/buckets.tf`. `tofu validate` clean.
- **scout app** (`255beaa33`): `vite:preloadError` reload-once recovery (sessionStorage-guarded) in `app/src/main.tsx`. typecheck + eslint clean.
- **Cloudflare** (`f442ab075`): new `tofu/cloudflare/modules/static-cache` (cache ruleset respect_origin on hashed prefixes + serve-stale + Smart Tiered Cache); wired into scout-for-lol.com, sjer.red, better-skill-capped.com. `tofu validate` clean vs provider v5.19.1.
- Verified: homelab cdk8s 140 pass / 0 fail; scripts/ci 301 pass + typecheck; dagger hygiene clean; **`dagger call caddyfile-validate` → "Valid configuration"**. PR #1328 title + body updated.

### Remaining

- CI (Buildkite) green + merge. Run the **Post-deploy checks** above once ArgoCD applies + a deploy runs (curl immutable/no-cache/304/404; `get-bucket-lifecycle-configuration`; confirm `cf-cache-status: HIT` on a warm hashed asset).
- When merged + shipped, flip Status to `Complete` and `git mv` this plan to `archive/completed/`.

### Caveats

- **`no-cache` on non-hashed sites**: resume/webring/glitter (no hashed prefix) now sync everything `no-cache` (was: no header → CF 4h default). Correct (revalidates), slightly more origin hits; negligible traffic.
- **`stocks-sjer-red`** gets `_astro/` immutable on deploy but has **no lifecycle rule** (no tofu bucket resource) → old hashes accumulate. Minor storage leak; add a bucket+lifecycle if it matters.
- **Lifecycle-by-age safety** rests on CI rebuilds writing fresh mtimes so `aws s3 sync` re-uploads current hashed assets each deploy (resetting their age). True for the Dagger container builds; a site that goes >90d without deploying could in theory expire a still-current hash — all listed buckets deploy far more often.
- **Cloudflare changes touch live zones** — `tofu validate` passed but a real `tofu plan` (needs creds via `op run`) should be eyeballed before apply, especially Smart Tiered Cache + the new ruleset.
- `tofu fmt -check` flags a **pre-existing** `backend.tf` formatting nit (not touched here).
