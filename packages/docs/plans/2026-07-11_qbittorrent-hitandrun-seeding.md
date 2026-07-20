---
id: plan-2026-07-11-qbittorrent-hitandrun-seeding
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Per-torrent Hit & Run–compliant seeding for qBittorrent

## Context

PrivateHD (the tracker behind the `media` namespace's qBittorrent) enforces Hit & Run (H&R)
rules: a torrent is _not_ a Hit & Run once you've either seeded it for a size-based required
time, **or** reached a 0.90 ratio — whichever comes first. The required time is:

```
size_gb <= 1        : 72 hours
1 < size_gb < 50     : 72 + 2 * size_gb hours
size_gb >= 50        : 100 * ln(size_gb) - 219.2023 hours
```

Before this change, qBittorrent enforced one **flat global cap** for every torrent
(`packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/qBittorrent.conf`:
`GlobalMaxSeedingMinutes=10080` = 7 days, `GlobalMaxRatio=1`, `ShareLimitAction=Stop`). That's
fine for anything under ~50GB, but the formula requires **up to ~9-13 days** for the 80GB+ UHD
REMUX files this setup regularly grabs (e.g. the three Transformers torrents at 80-85GB need
~219-225 hours ≈ 9.1-9.4 days — two full days past the 7-day cap). Those torrents only had a
per-torrent `ratio_limit=3` override (from Prowlarr's seed criteria) with no size-aware time
limit, so they were on track to stop seeding ~2 days before satisfying H&R.

This session also uncovered a live incident during investigation: the qBittorrent pod restart
from the `dd17d36eb fix(homelab): give qbittorrent startup probe a 15-minute runway` deploy caused
Radarr/Sonarr to bulk-remove 10 already-seeding torrents (and their on-disk files) within minutes
of the pod coming back, none of which were close to their ratio or time requirement (max ratio
seen: 0.31; max seed time: ~5.9 days). The user handled that incident manually; it's out of scope
for this plan by explicit user direction.

Goal: make every torrent's qBittorrent seeding requirement automatically match PrivateHD's actual
per-size H&R formula, going forward, with no manual per-torrent babysitting.

## Approach: formula-driven per-torrent share limits via qBittorrent's on-add hook

qBittorrent 5.x (confirmed live: `ghcr.io/linuxserver/qbittorrent` v5.2.0 in this cluster) exposes
an `AutoRun\OnTorrentAdded` hook and a `torrents/setShareLimits` endpoint that accepts a
per-torrent `seedingTimeLimit`. Wiring these together lets every torrent get an exact,
size-computed seeding-time limit the moment it's added — no cron, no polling, no separate infra.

This fits the existing config-as-code pattern for qBittorrent
(`packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts` +
`packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/`), which already commits
`qBittorrent.conf` and enforces it with a drift guard (`check-config-drift.sh`).

### 1. `configs/qbittorrent/hitandrun-share-limit.sh` (new)

- `hitandrun-share-limit.sh <hash>` — single-torrent mode, invoked by qBittorrent's
  `AutoRun\OnTorrentAdded` hook with the torrent's info hash (`%I`).
- `hitandrun-share-limit.sh --all` — backfill mode, iterates every currently-active torrent. Same
  logic reused for both the hook and one-off remediation of pre-existing torrents.
- Per torrent: auths to the local WebUI API (`QBT_USERNAME`/`QBT_PASSWORD` env vars), reads size
  and the torrent's **existing** `ratio_limit` (so Prowlarr's per-torrent ratio override, e.g.
  `3`, is passed through rather than clobbered), computes required seeding minutes via the formula
  above (python3, already present in the linuxserver image), and calls
  `POST /api/v2/torrents/setShareLimits` with the computed `seedingTimeLimit`.
- Structured logging on every invocation (hash, name, size, computed hours/minutes, ratio,
  `shareLimitAction`, HTTP status) to stdout — visible via `kubectl logs`. Failures log an
  `ERROR:` line and exit non-zero.
- **Gotcha found during implementation**: this qBittorrent build returns HTTP `204` (not `200`)
  from `auth/login` on success, `200` from `setShareLimits`. The script treats any `2xx` as
  success (`is_success_status()`) rather than hardcoding one status.

### 2. `torrents/qbittorrent.ts`

- Mounted the existing `seedVolume` (ConfigMap, already built from `configs/qbittorrent/` via
  `addDirectory`) into the main `qbittorrent` container at `/scripts` (previously only mounted
  into the init container at `/seed`).
- Added `QBT_USERNAME` (plain `jerred`) / `QBT_PASSWORD` (`EnvValue.fromSecretValue` from the
  existing `qBitTorrentItem` 1Password secret, same pattern the exporter container already uses)
  to the qbittorrent container's `envVariables`.

### 3. `qBittorrent.conf`

Added, under `[AutoRun]` (confirmed exact key spelling empirically by toggling the live
preference via the API and reading back the persisted conf — do not guess these from memory):

```
AutoRun\OnTorrentAdded\Enabled=true
AutoRun\OnTorrentAdded\Program=/bin/bash /scripts/hitandrun-share-limit.sh "%I"
```

Invoked via `/bin/bash` explicitly rather than relying on the script's own executable bit, since
ConfigMap volumes mount files at `0644` (not executable).

### 4. One-time backfill (done, live)

Ran the script in `--all` mode via `kubectl exec` against the live pod (not committed — a one-off
remediation, not ongoing infra). Confirmed via `torrents/info` that all three at-risk Transformers
torrents now carry a correct seeding-time limit instead of qBittorrent's global default (`-2`):

| Torrent                             | Size   | Required hours | seeding_time_limit (min) |
| ----------------------------------- | ------ | -------------- | ------------------------ |
| Transformers (2007)                 | 80.7GB | 219.9h         | 13195                    |
| Transformers: Revenge of the Fallen | 83.2GB | 222.9h         | 13377                    |
| Transformers: Dark of the Moon      | 85.0GB | 225.0h         | 13503                    |

### 5. Logging & observability

- Script logs a structured line per torrent (see above) — visible via `kubectl logs`.
- Checked whether `ghcr.io/esanchezm/prometheus-qbittorrent-exporter` (already deployed) exposes
  per-torrent ratio/seeding-time metrics: **it does not** — confirmed live via
  `curl localhost:17871/metrics`, which only exposes aggregate metrics
  (`qbittorrent_torrents_count`, `qbittorrent_firewalled`, `qbittorrent_up`, etc., no per-torrent
  labels). No custom exporter was built for this — documented as a known gap, not a blocker. A
  future improvement could add a small custom scrape (or a Grafana panel driven by an ad-hoc script
  hitting `torrents/info`) if per-torrent H&R visibility becomes worth the extra surface area.
- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/qbittorrent.ts` was
  reviewed; no changes made, since the exporter can't currently back a per-torrent alert.

## Test plan (executed)

1. **Formula unit tests** —
   `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/hitandrun-share-limit.test.ts`
   (new), sourcing the real script's `required_hours()` function (network calls and env-var
   requirements live in `main()`, gated behind a `[ "${BASH_SOURCE[0]}" = "${0}" ]` guard so
   sourcing for tests never touches the network). Covers the `<=1GB` floor, the linear branch,
   the 50GB boundary continuity, the logarithmic branch (verified against the three at-risk
   Transformers sizes), and a 200GB sanity check against the tracker's published chart. 5/5 pass.
2. **Drift-guard regression** — `check-config-drift.test.ts`: still 7/7 pass; generic over "any
   managed key" so no changes were needed for the new `AutoRun\OnTorrentAdded\*` keys.
3. **`bun run test`, `bun run typecheck`, `helm-template.test.ts`** — all pass; cdk8s synth renders
   cleanly with the new volume mount / env vars.
4. **`shellcheck`** on the new script — clean, no findings.
5. **Live functional check (backfill)** — executed and verified above (step 4).
6. **Live functional check (on-add hook itself)** — **not yet run**; the hook only takes effect
   once this PR deploys via ArgoCD (per-repo rule: no direct `kubectl apply`). See Remaining.

## Files changed

- `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/hitandrun-share-limit.sh` (new)
- `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/hitandrun-share-limit.test.ts` (new)
- `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/qBittorrent.conf` (added AutoRun keys)
- `packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts` (mounted seedVolume into main
  container at `/scripts`, added `QBT_USERNAME`/`QBT_PASSWORD` env vars)

No changes to Radarr/Sonarr (`packages/homelab/src/tofu/arr/resources.tf`) or recyclarr — both
already correctly defer torrent removal to qBittorrent's own seeding state.

## Session Log — 2026-07-11

### Done

- Diagnosed the Hit & Run seeding-rule gap (flat global cap vs. size-based formula) and confirmed
  it live against actual torrent sizes/ages in the cluster.
- Found and reported a live incident (restart-triggered bulk torrent/file removal); scoped out of
  this plan per user direction, user handling separately.
- Implemented `hitandrun-share-limit.sh` (dual-mode: on-add hook + `--all` backfill), wired it into
  `qbittorrent.ts` (volume mount + credentials) and `qBittorrent.conf` (AutoRun keys), confirming
  exact conf key names and HTTP status semantics (204 on login, not 200) empirically against the
  live pod before committing.
- Added formula unit tests, ran the full homelab test suite, typecheck, eslint, prettier, and
  shellcheck — all clean.
- Executed the one-time backfill against the three at-risk Transformers torrents; verified their
  `seeding_time_limit` now matches the H&R formula.
- Confirmed the qBittorrent Prometheus exporter has no per-torrent metrics to build an alert on;
  documented as a known gap.

### Remaining

- Open a PR from `feature/qbit-hitandrun-seeding` and deploy via ArgoCD.
- Post-deploy: confirm the pod starts cleanly (drift guard passes with the new conf keys), then
  run the live functional check — add a small throwaway public-domain test torrent, confirm the
  `AutoRun\OnTorrentAdded` hook fires (script's stdout log line appears in `kubectl logs`), and
  confirm `torrents/info` shows a non-`-2` `seeding_time_limit` within seconds.
- Re-verify the three backfilled Transformers torrents' limits survived the qBittorrent pod
  restart that this deploy will cause (their live per-torrent override lives in the app's own
  state file, not the committed conf, so it should survive a normal restart — but confirm).

### Caveats

- The restart-triggered bulk-removal bug (root cause of the incident found during investigation)
  is explicitly NOT addressed by this plan.
- The one-time backfill was applied directly to the live pod via `kubectl exec` (not IaC) — by
  design, since it's a one-off remediation of already-seeding torrents, not ongoing config.
- No Grafana/Prometheus alerting exists yet for "seeding limit never got set" — the exporter
  doesn't expose per-torrent fields to build one on.

## Remaining

- [ ] Complete and verify the work described in `Per-torrent Hit & Run–compliant seeding for qBittorrent`.
