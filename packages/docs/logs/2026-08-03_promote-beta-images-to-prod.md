---
id: 2026-08-03-promote-beta-images-to-prod
type: log
status: complete
board: false
---

# Promote beta images to prod

## Task

Promote all first-party beta image pins to prod in
`packages/homelab/src/cdk8s/src/versions.ts`.

## Scope

Two first-party apps carry `/beta` and `/prod` deployment-stage pins:

- `shepherdjerred/scout-for-lol`
- `shepherdjerred/starlight-karma-bot`

(`shepherdjerred/birmel` and `shepherdjerred/scout-evals` have no `/prod`
stage, so nothing to promote there.)

## Mechanism (per version-management / scout AGENTS.md)

Prod promotion = pinning the `/prod` entry to a **minted** `2.0.0-<n>`
tag@digest. On an **eligible Scout release build** — a main build that produces
a `shepherdjerred/scout-for-lol/beta` image candidate or a `site-scout` source
change (the `scout-beta-release`/`scout-tag-release` steps in
`.buildkite/pipeline.yml` short-circuit with `exit 0` otherwise) — the release
pipeline both immutably archives the prod-flavored site artifact and mints
`ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<n>` pointing at the backend digest
beta serves, so a minted tag's existence in GHCR guarantees its paired prod
site artifact exists. The artifact is **content-addressed**: `archiveFlavor`
stores it under `s3://scout-site-releases/<releaseInputDigest>/prod/`
(`scripts/lib/scout-site-storage.ts`); `versions/2.0.0-<n>.json` is only a
lookup record mapping the tag to that release state, **not** the artifact path.
`scout-prod-reconcile` resolves the pinned tag to its release state and
reconciles prod to that immutable archive (no separate site pin). Only ever pin
a minted tag@digest.

No standing Renovate promotion PR was open, so the promotion was done by
hand-editing the pins (doc-sanctioned).

## Changes

| Pin                        | Before                        | After                         |
| -------------------------- | ----------------------------- | ----------------------------- |
| `scout-for-lol/prod`       | `2.0.0-7074@sha256:f5e6add3…` | `2.0.0-7926@sha256:026d26b2…` |
| `starlight-karma-bot/prod` | `2.0.0-6673@sha256:4e0aaa2b…` | `2.0.0-7909@sha256:7e904d05…` |

### Verification of targets (before editing)

- `scout` beta pin's cosmetic tag `2.0.0-7924` does **not** exist as a real
  GHCR tag (it's a label on `:latest`). The latest **minted** scout tag is
  `2.0.0-7926`, whose digest `026d26b2…` is **identical** to the beta pin's
  digest — i.e. `-7926` is the minted release tag for the exact backend beta
  serves. Pinned prod to `2.0.0-7926@sha256:026d26b2…`.
- `starlight-karma-bot` beta pin `2.0.0-7909@sha256:7e904d05…` **is** a real
  minted GHCR tag (verified `crane digest` matches). It is also the latest
  karma-bot tag. Pinned prod to the same value.

`crane digest` / `crane ls` used to confirm every tag+digest before editing.

## Session Log — 2026-08-03

### Done

- Edited `packages/homelab/src/cdk8s/src/versions.ts`: promoted
  `scout-for-lol/prod` → `2.0.0-7926@sha256:026d26b2…` and
  `starlight-karma-bot/prod` → `2.0.0-7909@sha256:7e904d05…`.
- Verified both target tags/digests exist in GHCR and match the backend digest
  beta serves.
- `bunx turbo run typecheck --filter=homelab` — passes.

### Remaining

- Open the PR and let it merge; on merge to main, ArgoCD rolls the prod
  backends and `scout-prod-reconcile` syncs the prod site bucket from the
  immutable content-addressed archive for the pinned `2.0.0-7926` release state.
- Post-merge, confirm prod serves the promoted site: the prod bucket's
  `.release-version` marker (`curl https://scout-for-lol.com/.release-version`)
  should read `scout-site@<releaseInputDigest>` — the content identity
  `siteReleaseIdentity` writes (`scripts/lib/scout-release-state.ts`), not the
  bare `7926` tag number.

### Caveats

- This is a production deploy of both apps. Rollback = revert the promotion
  commit, or hand-edit a pin back to an older minted tag@digest.
- The prod site identity is the release's content digest (`releaseInputDigest`),
  resolved from the pinned tag's release state — not the `-7926` tag portion
  itself; do not hand-pair a tag with a mismatched digest.
