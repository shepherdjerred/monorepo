---
id: log-2026-06-27-scout-prod-promote-4653
type: log
status: complete
board: false
---

# Scout prod promotion to 2.0.0-4653

## Summary

Promoted the Scout (`scout-for-lol`) production image to match the latest beta
build, per user request to "update scout prod to latest beta version" and push
directly to main.

- File: `packages/homelab/src/cdk8s/src/versions.ts`
- Key: `shepherdjerred/scout-for-lol/prod`
- Before: `2.0.0-4537@sha256:c3112975f3da477403fc72f621508b4ffd32b0ace90f481de87c9387b6f8e6ba`
- After: `2.0.0-4653@sha256:fe82c9bab75d1ede15042ab0bcc6bc2bd25bbd761e265e5c825371b86243a03e`

The `beta` channel is auto-updated by CI's `version-commit-back` on every main
build; prod is a manual promotion. The new prod value is copied verbatim from
the current `beta` pin (`versions.ts:127`), so prod now runs the same image beta
has been running.

ArgoCD will roll the `scout-prod` app to the new digest once the homelab CI
build publishes the updated chart.

## Session Log — 2026-06-27

### Done

- Edited `packages/homelab/src/cdk8s/src/versions.ts` to promote
  `scout-for-lol/prod` from `2.0.0-4537` to `2.0.0-4653` (matching beta).
- Committed as `b91a5f1ef` `chore(homelab): promote scout-for-lol/prod to 2.0.0-4653`.
- Pushed directly to `main` (`72eb9628e..b91a5f1ef`); all pre-commit gates green
  (homelab-versions-validate, typecheck, helm-lint, cdk8s tests, 1Password lint).

### Remaining

- None. Watch the homelab Buildkite build + ArgoCD `scout-prod` sync to confirm
  the rollout lands on the new digest.

### Caveats

- "Latest beta" = the current `beta` pin in `versions.ts` (build 4653, committed
  in #1330 ~2h before this change). If an even newer beta build lands after this,
  re-promote.
