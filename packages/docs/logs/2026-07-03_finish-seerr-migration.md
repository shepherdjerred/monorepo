# Finish Overseerr → Seerr Migration

## Status

**Blocked — do NOT merge.** Code change is complete and verified, but an
in-cluster audit found Overseerr is still the live, actively-used system and
users/requests have **not** been migrated to Seerr. Removing Overseerr now would
cut off 5+ active users and discard 156 requests of history. See
"Migration-readiness audit" below.

## Migration-readiness audit (2026-07-03)

Copied both SQLite DBs out of the running pods and compared:

| | Seerr (new) | Overseerr (old) |
|---|---|---|
| Users | **1** (owner only) | **8** (owner + 7 friends/family) |
| Media requests | **0** | **156** |
| Requests last 30d | 0 | **15** |
| Newest real request | — | 2026-06-29 (ariali459) |
| Active requesters | just owner | ShepherdJerred 56, wnicol4 41, ariali459 25, Jones1000000 13, ognynnad 11, RcFlyer96 10 |

**Seerr configuration is complete** (Plex libs Movies+TV synced, Radarr+Sonarr
default servers with quality profiles + root folders, email+Discord
notifications). But operationally it is an empty shell — only the owner has ever
logged in. Overseerr (`overseerr.sjer.red`) is what everyone actually uses.

There is **no** redirect or notice pointing users at `seerr.sjer.red`, and none
of the 7 other Plex users have accounts on Seerr.

### Before Overseerr can be removed

1. **Migrate users** — In Seerr, Settings → Users → Import Plex Users (pulls the
   shared Plex users), or migrate by copying Overseerr's DB (Seerr is an
   Overseerr fork; schema is compatible).
2. **Migrate request history** — No built-in Overseerr→Seerr importer. Cleanest
   path: copy Overseerr's `/config/db/db.sqlite3` into Seerr's
   `/app/config/db/db.sqlite3` (compatible schema) and keep Seerr's
   `settings.json`. Then re-verify server connections.
3. **Tell users to switch** — Update Plex/Discord messaging and/or point
   `overseerr.sjer.red` at Seerr (or send a notification) so users land on Seerr.
4. Only then remove Overseerr (this branch) and prune the DNS record.

## Context

Seerr (`ghcr.io/seerr-team/seerr`) was deployed alongside the legacy
LinuxServer Overseerr (`ghcr.io/linuxserver/overseerr`) during the request-flow
migration (see `2026-05-22_pr-751-keep-overseerr.md`). This session removes
Overseerr now that Seerr fully owns the request flow.

### Verification that Seerr is the live source of truth

Before removing Overseerr, confirmed the in-cluster Seerr pod is fully
configured (not a fresh/empty instance):

- `media-seerr-*` pod up 16d; `settings.json` last modified the day of this
  session (actively in use).
- Plex connected (server `torvalds`), 1 Radarr + 1 Sonarr configured.

## Changes

- Deleted `packages/homelab/src/cdk8s/src/resources/torrents/overseerr.ts`
  (deployment, PVC, service, Tailscale ingress, Cloudflare tunnel binding).
- Removed the `createOverseerrDeployment` import + call from
  `cdk8s-charts/media.ts`.
- Removed the `linuxserver/overseerr` version pin (and its migration comment)
  from `versions.ts`.
- Removed the `sjer_red_cname_overseerr` Cloudflare DNS record from
  `src/tofu/cloudflare/sjer-red.tf`.

## Verification

- `bun run typecheck` — pass.
- `bun run build` — renders; `overseerr` absent from `dist/`, Seerr present in
  `dist/media.k8s.yaml`, Plex Intel GPU resource unchanged.
- `bun run test` — 251 pass / 5 skip / 0 fail (cdk8s) + 152 pass (helm-types).
- `tofu -chdir=cloudflare validate` — success.

## Deploy-time effects (GitOps prune)

When this merges and ArgoCD syncs, the following Overseerr resources are pruned:
Deployment, Service, Tailscale ingress, Cloudflare tunnel binding, and the
`overseerr-pvc` PersistentVolumeClaim. Overseerr's config data on that PVC is
discarded — intended, since Seerr is now the source of truth. `overseerr.sjer.red`
stops resolving after the Cloudflare `tofu apply`.

## Session Log — 2026-07-03

### Done

- Removed all Overseerr IaC: `overseerr.ts`, `media.ts` wiring, `versions.ts`
  pin, and the Cloudflare DNS record.
- Verified Seerr is fully configured live before removal.
- Typecheck, build, tests, and tofu validate all green.
- Marked `2026-05-22_pr-751-keep-overseerr.md` Complete.

### Remaining

- Open PR, get Buildkite CI green, merge.
- After merge, run `op run --env-file=.env -- tofu -chdir=cloudflare apply`
  from `packages/homelab/src/tofu` to remove the `overseerr` DNS record (the
  cdk8s changes deploy via ArgoCD automatically).

### Caveats

- **Maintainerr integration:** Maintainerr connects to Overseerr/Seerr via its
  own runtime config (not IaC). If it still points at the Overseerr URL, update
  it to Seerr in the Maintainerr UI or its config PVC before Overseerr is pruned.
- **Overseerr PVC data is discarded** on ArgoCD prune. Seerr started fresh on
  its own `seerr-pvc`; any request history in Overseerr is not carried over.
- The `linuxserver-containers` skill cites Overseerr as an example deployment —
  left as-is since it's an illustrative example, not a live-deployment claim.
