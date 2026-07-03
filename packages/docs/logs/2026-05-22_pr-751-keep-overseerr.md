# PR 751 — Keep Overseerr Alongside Seerr

## Status

In Progress — removal is staged on branch `feature/finish-seerr-migration` but
**held**: a 2026-07-03 audit found Overseerr is still the live system (8 users /
156 requests vs Seerr's 1 user / 0 requests). Users + request history must be
migrated first. See `packages/docs/logs/2026-07-03_finish-seerr-migration.md`.

## Context

[PR #751](https://github.com/shepherdjerred/monorepo/pull/751) originally
replaced Overseerr with Seerr, preserving `overseerr-pvc` and adding temporary
`overseerr` service/DNS aliases that pointed at the Seerr deployment.

Per follow-up direction, Overseerr should remain deployed alongside Seerr while
the migration is in progress. The Seerr alias services are no longer needed —
the real Overseerr deployment will own those names.

## Changes

- Restored `packages/homelab/src/cdk8s/src/resources/torrents/overseerr.ts`
  (deleted in commit `b06efd396`).
- Re-added the `linuxserver/overseerr` version pin in `versions.ts` with a
  comment noting it stays during the migration.
- Wired `createOverseerrDeployment(chart)` back into `cdk8s-charts/media.ts`
  alongside `createSeerrDeployment(chart)`.
- In `seerr.ts`:
  - Renamed the PVC from `overseerr-pvc` to `seerr-pvc` so it no longer
    conflicts with the real Overseerr's PVC of the same name.
  - Removed the `overseerr-service`, `overseerr-tailscale-ingress`, and
    `overseerr-cf-tunnel` alias resources — Overseerr's own resources now
    own those names again.

## Migration Notes

- Overseerr continues to serve `overseerr.sjer.red` and `overseerr.<tailnet>`.
- Seerr serves `seerr.sjer.red` and `seerr.<tailnet>` (Cloudflare DNS records
  for both were added in commit `518084410`).
- Overseerr keeps its existing `overseerr-pvc` (no data loss).
- Seerr starts fresh on its own `seerr-pvc`.
- When the migration is complete, remove `overseerr.ts`, the
  `createOverseerrDeployment` call in `media.ts`, the `linuxserver/overseerr`
  version pin, and the `overseerr` Cloudflare DNS record.
