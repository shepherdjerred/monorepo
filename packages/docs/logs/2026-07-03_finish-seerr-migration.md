# Finish Overseerr → Seerr Migration

## Status

**Ready to merge.** The 8 users + 156 requests were migrated into Seerr and an
edge redirect `overseerr.sjer.red → seerr.sjer.red` is live (both executed
2026-07-03). This branch (`feature/finish-seerr-migration`) removes the Overseerr
deployment and adds the redirect ruleset. After merge, manually prune the
orphaned Overseerr resources (ArgoCD prune is off).

## Context

Seerr (`ghcr.io/seerr-team/seerr`) had been running alongside the legacy
LinuxServer Overseerr (`ghcr.io/linuxserver/overseerr`) during the request-flow
migration (see `2026-05-22_pr-751-keep-overseerr.md`). This session finishes the
migration and removes Overseerr.

## Pre-cutover audit — Overseerr was still the live system

An in-cluster DB comparison found Seerr was fully _configured_ but operationally
an empty shell; Overseerr was what everyone actually used:

|                     | Seerr (before)     | Overseerr                                                                               |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| Users               | **1** (owner only) | **8** (owner + 7 friends/family)                                                        |
| Media requests      | **0**              | **156**                                                                                 |
| Requests last 30d   | 0                  | **15**                                                                                  |
| Newest real request | —                  | 2026-06-29 (ariali459)                                                                  |
| Active requesters   | just owner         | ShepherdJerred 56, wnicol4 41, ariali459 25, Jones1000000 13, ognynnad 11, RcFlyer96 10 |

So removing Overseerr required migrating users + request history first, plus a
redirect so people land on Seerr.

## Config comparison (verified)

Field-by-field diff of both `settings.json`: **all meaningful config is
identical** — Plex (`media-plex-service:32400`, both libraries synced), Radarr
(`media-radarr-service:7878`, profile "Best Available", root `/movies`), Sonarr
(`media-sonarr-service:8989`, profile "Best Available", root `/tv`), Tautulli,
and all API keys match. Differences were only branding/expected: `applicationTitle`,
`applicationUrl` (each → itself), `newPlexLogin` (Seerr false vs Overseerr true —
flipped to true during cutover), `webpush.enabled` (Seerr false — moot).

## DB migration — validated then executed

Seerr is a Jellyseerr-lineage fork: schema-compatible with Overseerr but ahead
(adds `blocklist`/`override_rule`/`watchlist` tables). Overseerr had one migration
Seerr lacked (`UpdateWebPush1740717744278`) — the one possible conflict point.

**Validated first** in an isolated Docker run (`ghcr.io/seerr-team/seerr`) against
a consolidated copy of Overseerr's live DB: booted clean, **zero migration errors**
(webpush divergence did not conflict), forward-migrated the schema, and preserved
all 8 users / 156 requests / 236 media rows.

**Executed cutover:**

1. Consolidated Overseerr's live DB (`VACUUM INTO`); backed up Seerr's DB +
   settings locally and in-PVC (`db.sqlite3.pre-migration`,
   `settings.json.pre-migration`).
2. Temporarily disabled ArgoCD auto-sync on the `media` app — a bare
   `automated: {}` still reverted a manual scale-to-0 within ~3s, so auto-sync
   had to be toggled off for the window.
3. Scaled `media-seerr` to 0; swapped the consolidated DB into `seerr-pvc` via a
   throwaway editor pod (ran as uid 1000 to match ownership + satisfy Kyverno);
   removed stale `-wal`/`-shm`; also wrote patched `settings.json` with
   `newPlexLogin: true` (parity with Overseerr, so Plex friends can self-sign-in).
4. Scaled back to 1; re-enabled auto-sync.
5. Seerr booted clean (v3.3.0), forward-migrated 33 → 53 migrations, **zero
   errors**. Live verify: **8 users, 156 requests, 236 media rows**, new tables
   present, API `initialized: true`.

The imported DB and `newPlexLogin` live in the `seerr-pvc` (runtime state), not
IaC.

## Redirect — executed

Added `cloudflare_ruleset.sjer_red_redirects` (dynamic-redirect phase) in
`sjer-red.tf`: 301 `overseerr.sjer.red` → `seerr.sjer.red`, path + query
preserved. Kept the Overseerr CNAME so the host still resolves; the edge redirect
fires before the (now routeless) tunnel is contacted — same pattern as
`discord-plays-pokemon-com.tf`.

Applied via `tofu apply -target=cloudflare_ruleset.sjer_red_redirects` (1 added,
0 changed). Verified live: `overseerr.sjer.red/requests?filter=all` → 301 →
`seerr.sjer.red/requests?filter=all`.

## Code changes (this branch)

- Deleted `packages/homelab/src/cdk8s/src/resources/torrents/overseerr.ts`.
- Removed the `createOverseerrDeployment` import + call from `cdk8s-charts/media.ts`.
- Removed the `linuxserver/overseerr` version pin from `versions.ts`.
- Kept the `sjer_red_cname_overseerr` record and added the redirect ruleset in
  `sjer-red.tf`.

Verification: `bun run typecheck`, `bun run build` (overseerr absent from `dist/`,
Plex GPU unchanged), `bun run test` (251 pass / 5 skip / 0 fail cdk8s + 152 pass
helm-types), `tofu validate` — all green.

## Session Log — 2026-07-03

### Done

- Migrated Overseerr → Seerr live: imported 8 users + 156 requests into
  `seerr-pvc` (validated in Docker first; executed with backups + auto-sync off);
  flipped `newPlexLogin` → true.
- Redirect live: added + applied the `overseerr.sjer.red → seerr.sjer.red`
  ruleset; verified 301 with path/query preserved.
- Removed Overseerr IaC; all local checks green.
- Repointed **Maintainerr** to Seerr via its settings API (POST `/api/settings`):
  `overseerr_url` → `http://media-seerr-service:5055`, `overseerr_api_key` →
  Seerr's key. Verified from the Maintainerr pod that the authed Seerr API
  responds and returns all 156 requests. Runtime PVC config, not IaC.
- Opened PR #1385.
- Marked `2026-05-22_pr-751-keep-overseerr.md` Complete.

### Remaining

- Open PR for `feature/finish-seerr-migration`, get Buildkite CI green, merge.
- After merge, manually prune the orphaned Overseerr resources + `overseerr-pvc`
  (ArgoCD prune is off): Deployment, Service, Tailscale ingress, CF tunnel binding.
- Optional: message users that requests now live at `seerr.sjer.red` (the
  redirect already covers old bookmarks).

### Caveats

- Cloudflare prod state is **ahead of `main`** (ruleset already applied from this
  branch). Don't `tofu apply` cloudflare from `main` before merge — it would
  destroy the ruleset.
- The imported DB + `newPlexLogin=true` live in `seerr-pvc`, not IaC — a PVC
  restore/rebuild would revert them.
- Overseerr pod keeps running until manually pruned; just unreachable via
  `overseerr.sjer.red` (still reachable on its tailnet host until deleted).
- **Maintainerr** was repointed to Seerr (done this session, see Done). Its
  config is runtime PVC state, not IaC — a PVC restore would revert it.
- Local backups (Seerr's pre-migration DB + settings, which contain SMTP/webhook
  secrets) are in the session scratchpad only — not committed.
