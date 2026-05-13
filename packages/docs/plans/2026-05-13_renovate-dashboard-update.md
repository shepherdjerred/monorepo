# Renovate Dashboard Update Batch

## Status

Complete

## Summary

Update the actionable Renovate dashboard items in one dependency PR, limited to version and digest pins. No runtime API, schema, or public type changes are intended.

Do not change Java: `.mise.toml` already uses Corretto Java `25.0.3+9-LTS`, and the user chose to keep Corretto rather than switch vendors. Do not change TypeScript unless a final search finds an active package still below `6.0.3`; active manifests already show `^6.0.3`.

## Key Changes

- Update `.dagger/src/constants.ts`:
  - `HELM_IMAGE`: keep `alpine/helm:4.1.4`, replace digest with `sha256:8edcaedab4d9864886b7f443d55731be87d4b5ec7dca714c24551455707a8aac`
  - `CADDY_IMAGE`: `caddy:2.11.3-alpine@sha256:bb56e6200ec26a67f04be90255993dc390c9815967f67f24b4ca6466e88de64b`
  - `CADDY_BUILDER_IMAGE`: `caddy:2.11.3-builder-alpine@sha256:7d2315853f99b425d0daa6bcad826e8b0d65b4af1f70fcaeb6b152157d81771d`
- Update `packages/homelab/src/cdk8s/src/versions.ts`:
  - `kube-prometheus-stack`: `85.0.1` -> `85.0.2`
  - `linuxserver/bazarr`: keep `1.5.6`, replace digest with `sha256:4b7bb6d861c08bbf0c388b936ada8b2ba57669ca9974323f504e974577d19d63`
  - `shepherdjerred/scout-for-lol/prod`: `2.0.0-2389@sha256:5eeb9f77289409ab97dd1e4a8b311ef809832e71d4035a4a99d24b36aa9d98d0`
  - `shepherdjerred/starlight-karma-bot/prod`: `2.0.0-2389@sha256:2e7d70440860bcd872d4d4f0dddda88e6436ec6e86b0990a0b9450549ebdf012`
- Update `packages/discord-plays-pokemon/compose.yml`:
  - `ghcr.io/shepherdjerred/discord-plays-pokemon@sha256:762042af4a55a0f91074f055c919349c35beb75538ba017e552b4d956e614f0c`

## Test Plan

- Verify exact pins:
  - `crane digest` for updated Docker tags.
  - `helm show chart kube-prometheus-stack --repo https://prometheus-community.github.io/helm-charts --version 85.0.2`.
- Run focused checks:
  - `bun test ./.dagger/src/__tests__/constants.test.ts`
  - `cd packages/homelab/src/cdk8s && bun test src/versions.test.ts src/helm-template.test.ts`
  - `cd packages/homelab && bun run scripts/check-docker-images.ts`
  - `bunx prettier --check .dagger/src/constants.ts packages/homelab/src/cdk8s/src/versions.ts packages/discord-plays-pokemon/compose.yml packages/docs/plans/2026-05-13_renovate-dashboard-update.md packages/docs/index.md`
  - `git diff --check`

## Assumptions

- Java dashboard item is satisfied by current Corretto `25.0.3+9-LTS`; no `.mise.toml` edit.
- TypeScript dashboard item is already satisfied for active packages; no package or lockfile edit expected.
- Production image bumps for Scout and Starlight are intentional, despite triggering GitOps deployments.
- Existing unrelated untracked docs logs are not part of this change.

## Session Log — 2026-05-13

### Done

- Updated `.dagger/src/constants.ts`: Caddy runtime/builder images to `2.11.3` with pinned digests and refreshed `alpine/helm:4.1.4` digest.
- Updated `packages/homelab/src/cdk8s/src/versions.ts`: `kube-prometheus-stack` `85.0.1` -> `85.0.2`, refreshed `linuxserver/bazarr:1.5.6` digest, and promoted Scout/Starlight prod image pins to `2.0.0-2389`.
- Updated `packages/discord-plays-pokemon/compose.yml` to the `2.0.0-2389` image digest.
- Added this plan and linked it from `packages/docs/index.md`.
- Verified Docker digests with `crane digest` and chart availability with `helm show chart`.
- Verification passed: Dagger constants test, homelab versions + Helm template tests, homelab Docker digest checker, Prettier check, and `git diff --check`.

### Remaining

- None for the requested dashboard batch.

### Caveats

- `.mise.toml` was left on Corretto Java `25.0.3+9-LTS` by user choice; the dashboard wording appears to be a vendor-string difference, not an actual Java patch gap.
- TypeScript was already `^6.0.3` across active package manifests inspected during planning, so no package or lockfile edit was made.
- The plan is marked complete but remains in `packages/docs/plans/` because this local change has not been shipped or merged yet.
- Existing untracked docs logs were left untouched.
