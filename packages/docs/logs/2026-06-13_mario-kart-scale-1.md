# Scale discord-plays-mario-kart to 1 replica

## Status

Complete (PR open, awaiting merge)

## Context

Asked whether Mario Kart was "scaled to 0". Live cluster showed the `mario-kart`
Deployment at `1` desired / `0` ready (pod mid-startup, `ContainerCreating`) — it
had just been manually scaled `0 → 1`. But in **source** it was pinned to
`replicas: 0` (`packages/homelab/src/cdk8s/src/resources/mario-kart.ts:38`), so the
manual scale-up would drift and ArgoCD would revert it to `0` on the next sync.

## Change

- `mario-kart.ts`: `replicas: 0` → `replicas: 1` so the committed desired state
  keeps the bot running.

## Verification

- `bun run typecheck` (homelab) — clean.
- Pre-commit hooks all green (eslint-homelab, quality-ratchet, homelab-helm-lint,
  homelab-typecheck, check-todos, prettier, commit-msg).
- Deploys via ArgoCD; on merge Argo reconciles the live deployment to 1 replica.

## Session Log — 2026-06-13

### Done

- Edited `packages/homelab/src/cdk8s/src/resources/mario-kart.ts` (`replicas: 0 → 1`).
- Commit `be5172973` on `feature/mario-kart-scale-1`; opened PR #1169.

### Remaining

- Merge PR #1169 and let ArgoCD sync.

### Caveats

- The MK64 ROM is not in the image — it lives on the `mario-kart-rom-volume` ZFS
  PVC and must be copied in once (`kubectl cp <rom> <pod>:/workspace/packages/discord-plays-mario-kart/roms/mariokart64.z64`).
  If the PVC already holds the ROM from a prior run, the pod starts clean; otherwise
  the app needs the ROM before it's playable.
