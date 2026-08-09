---
id: plan-2026-08-09-strip-matomo-cutover-machinery
type: plan
status: in-progress
board: false
---

# Strip the Matomo cutover machinery

## Context

The Plausible → Matomo migration (#2011) was meant to be a quick cutover. Instead the
PR accreted five successive "gate the cutover safely" patches, which shipped a
permanent CI apparatus to protect a **one-time, manual** operator action.

The result was net-negative:

- `wait-for-matomo.ts` probes `matomo.php?module=API&method=API.getMatomoVersion`.
  `matomo.php` is the **tracker** entry point and does not implement `module=API`
  (`getMatomoVersion` exists only in `core/API/Request.php` and `plugins/API/API.php`,
  both served by `index.php`). It has returned **HTTP 400 since the day it merged** —
  verified against the live host after the gate was opened. It gates **four** CI steps,
  so it could never have passed.
- To support it, `argocd-sync` **conditionally skips its own authoritative
  `release-health-wait`** whenever `pokemon` or `mario-kart` are in the release plan.
  The strength of the release health gate silently varies build to build.
- `matomo-sites` was split out of `sites` solely to carry that gate, adding a whole
  step plus `argocd-sync` + `tofu-cloudflare` dependencies.

The cutover is now **complete**: Matomo is installed, all 8 sites registered, the
archive loop runs clean (`[8 / 8 done]`, `no error`), `matomo` is Synced/Healthy, and
`matomo.sjer.red` serves 200s. None of this machinery has any remaining job.

**Outcome:** delete the cutover apparatus, return Matomo to the repo's standard
deploy flow, and restore `argocd-sync`'s health gate to being unconditional.

## Changes

### 1. Delete the readiness gate

- **Delete** `packages/homelab/scripts/wait-for-matomo.ts`.
- Remove its four invocations in `.buildkite/pipeline.yml` (`matomo-sites`,
  `scout-beta-release`, `scout-prod-reconcile`, `discord-tracker-apps`).
- Drop it from: the PR-side `if_changed` list (`pipeline.yml` ~line 969), the `argocd`
  lane inputs in `.buildkite/scripts/migration-core.ts` (~line 388), the `lint` script in
  `packages/homelab/package.json`, and `packages/homelab/tsconfig.scripts.json`.

### 2. Fold `matomo-sites` back into `sites`

`matomo-sites` exists only to carry the gate. Move its four lanes
(`site-sjer-red`, `site-resume`, `site-webring`, `site-better-skill-capped`) into the
standard `sites` step and **delete the step**, including its extra `argocd-sync` /
`tofu-cloudflare` dependencies — the DNS record those waited on is now permanent.

### 3. Delete `discord-tracker-apps` and the deferral machinery

The step exists only to hold `pokemon` / `mario-kart` back until Matomo was public.
Delete it; `argocd-sync`'s `reconcile-release` then syncs them like every other app.

- `.buildkite/pipeline.yml` `argocd-sync`: drop the `deferred_discord_apps` jq
  computation and both branches, leaving one unconditional path:
  `suspend-auto-sync` → `reconcile-release … --timeout 300` →
  `sync apps … --prune --async` → `release-health-wait … --timeout 300`.
- Remove `discord-tracker-apps` from `scout-beta-release`'s `depends_on`, and both
  deleted steps from the build-summary lane list (~lines 1787-1788) and from
  `migration-core.ts` (~line 210).
- `packages/homelab/scripts/argocd.ts`: remove the `deferredApps` parameter, the
  `--defer-apps` / `--skip-health-wait` flags, their arg parsing and usage string
  (~lines 549-560, 578, 881, 912, 991-992).
- `.buildkite/scripts/validate-pipeline-release.ts`: drop the `matomo-sites` and
  `discord-tracker-apps` assertion blocks and the `discord-tracker-apps` entry under
  `scout-beta-release`.
- `packages/homelab/src/cdk8s/src/argocd-script.test.ts`: remove the
  `--skip-health-wait` case (~line 603).

### 4. Remove the nginx public gate

In `packages/homelab/src/cdk8s/src/resources/analytics/matomo.ts`, delete the
`matomo-public-gate` container, the `matomo-public-gate-config` ConfigMap and its
volume, the `publicReadyMarker` constant, and the separate `publicService`. Then:

- Point `createCloudflareTunnelBinding` at the main `service` (port 80) instead of
  `publicService`.
- Set `publicProbePath` to **`/matomo.php`** — verified 200 with a non-empty body.
  (This also repairs the blackbox probe, which has been failing for the same reason
  as the CI gate.)
- NetworkPolicy: change the `cloudflare-tunnel` ingress port from **8080 → 80**, and
  drop 8080 from the `prometheus` ingress ports.
- Update `matomo.test.ts` — it asserts the gate ConfigMap name and the `public-gate`
  container.

The `.matomo-public-ready` file already on the PVC becomes vestigial and is harmless.

### 5. Fix the two wrong hostnames

`config/analytics-sites.json` names domains that do not serve those apps:

| siteId | current (wrong)                                                          | correct              |
| ------ | ------------------------------------------------------------------------ | -------------------- |
| 5      | `discord-plays-mario-kart.com` — **NXDOMAIN**, no Cloudflare zone        | `mariokart.sjer.red` |
| 6      | `discord-plays-pokemon.com` — redirect-only zone (`AAAA 100::` → GitHub) | `pokebot.sjer.red`   |

Real hostnames come from the tunnel bindings: `mario-kart.ts:251` (`subdomain: "mariokart"`)
and `pokemon.ts:298` (`subdomain: "pokebot"`), expanded by `cloudflare-tunnel.ts:60` to
`${subdomain}.sjer.red`. Update the matching `staticTrackers` entries in
`scripts/check-analytics-sites.ts`.

**Keep `check-analytics-sites.ts` itself, and do not extend it.** The registry is
load-bearing — `scripts/scout-site-release.ts` injects site IDs 7/8 into Scout at build
time from it — while the other six sites hard-code their IDs in committed files. This
check is the only thing keeping those two representations in sync, and its failure mode
(analytics silently landing in the wrong site) is one you would not notice for months.
It runs only in `verify` and costs nothing at runtime.

### 6. Docs

Update `packages/docs/wiki/src/content/docs/homelab/matomo.md` — remove the cutover
gate, the `touch .matomo-public-ready` step, and the public-gate container from the
readiness description.

## Verification

```bash
bunx turbo run typecheck test lint --filter=homelab --filter=@homelab/cdk8s
bun run scripts/check-analytics-sites.ts
bun --no-install .buildkite/scripts/validate-pipeline-release.ts
bunx turbo run build --filter=@homelab/cdk8s
```

Then inspect `packages/homelab/src/cdk8s/dist/matomo.k8s.yaml` to confirm: no
`public-gate` container or ConfigMap, one Service, and the tunnel binding targeting
port 80.

Post-merge on `main`:

1. `argocd-sync` passes **and** its log shows `release-health-wait` actually running
   (no `defer` line) — the gate is unconditional again.
2. `curl -s -o /dev/null -w '%{http_code}' https://matomo.sjer.red/matomo.php` → `200`
   (proves the tunnel still reaches Matomo after the gate removal).
3. `pokemon` and `mario-kart` reach Synced/Healthy via `argocd-sync` alone.
4. The matomo blackbox probe goes green.

## Out of scope

Tracked separately, from the CI outage investigation:

- **git-mirror maintenance** — 58.5 GiB of orphaned `tmp_pack_*` took down all CI;
  uncontained and refills in ~4-5 days. Highest-value remaining item.
- **main-branch churn** — 62% of recent main builds cancelled, which both orphans those
  temp packs and causes the `Refusing stale Helm/Argo release` failures.
- `loki` (immutable StatefulSet field), `minecraft-shuxin` (`check-config-drift`),
  `plane-enterprise` (OutOfSync).
- Rotating the MariaDB password echoed into a session transcript by `config:set`.
