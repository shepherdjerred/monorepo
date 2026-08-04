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
tag@digest. Every main build both archives the prod-flavored site artifact to
`s3://scout-site-releases/2.0.0-<n>/` and mints
`ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<n>` pointing at the backend digest
beta serves — so a minted tag's existence in GHCR guarantees its paired prod
site artifact exists. `scout-prod-reconcile` derives the prod site version from
the pin's tag portion (no separate site pin). Only ever pin a minted tag@digest.

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
  archived `2.0.0-7926` artifact.
- Post-merge, confirm prod serves the promoted versions:
  `curl https://scout-for-lol.com/.release-version` should report `7926`.

### Caveats

- This is a production deploy of both apps. Rollback = revert the promotion
  commit, or hand-edit a pin back to an older minted tag@digest.
- Scout prod site version is derived from the pin's tag portion (`-7926`); do
  not hand-pair a tag with a mismatched digest.
