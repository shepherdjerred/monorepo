# Turbo remote cache rollout (local + CI)

## Status

Partially Complete — code + secrets done; R2 bucket apply blocked on a
Cloudflare token permission the operator must add in the dashboard.

## What happened

Executed `todo: turbo-cache-rollout` (staged by the CI-parity work): brought
the ducktors/turborepo-remote-cache server from "fully written but commented
out" to deploy-ready, and wired turbo remote caching for CI and dev shells.

- Uncommented `createTurboCacheChart` / `createTurboCacheApp`, added
  `helm/turbo-cache/Chart.yaml` + empty `values.yaml`. Synth verified; the
  Service renders as `turbo-cache-turbo-cache-service` (ns `turbo-cache`).
  `helm-push.ts` discovers charts from the `helm/` dir — no list to update.
- Created 1Password item `turbo-cache-r2` (`jdhq6ptnbds2x55fshah6n2hyi`,
  Homelab (Kubernetes) vault). **Decision:** S3 keypair reuses the
  account-wide "CloudFlare R2" token instead of a bucket-scoped mint
  (operator chose convenience over least privilege; the Cloudflare API
  cannot mint R2 S3 tokens — dashboard only — and the tofu token cannot
  create account tokens either, 403).
- Generated a fresh `TURBO_TOKEN` (openssl rand -hex 32); same value in
  `turbo-cache-r2` (server side) and `buildkite-ci-secrets` (client side).
  Refreshed + committed the vault snapshot; `check:1password` passes.
- CI: `.buildkite/pipeline.yml` global env now sets
  `TURBO_API=http://turbo-cache-turbo-cache-service.turbo-cache.svc.cluster.local:3000`
  (CI pods are in-cluster — the tailnet ingress is for dev machines) and
  `TURBO_TEAM=monorepo`; `TURBO_TOKEN` arrives via the existing
  `buildkite-ci-secrets` envFrom. Turbo keeps remote caching disabled until
  all three are present, so partial config degrades to local-only.
- Dev shells: `config.fish.tmpl` (chezmoi source, PR) + live
  `~/.config/fish/config.fish` (dual-edit rule) export
  `TURBO_API=https://turbo-cache.tailnet-1a49.ts.net`, `TURBO_TEAM`,
  `TURBO_TOKEN` (via `onepasswordRead`).

## Blocker found: tofu token has no R2 permission

`cloudflare_r2_bucket.turbo_cache` cannot be applied: the
"Cloudflare API Token (Tofu - Full)" token 403s on ALL R2 endpoints (even
reads). This would also have broken CI's `tofu apply (cloudflare)` step on
first post-merge build. Fix is dashboard-only: add
**Account → Workers R2 Storage → Edit** to that token, then targeted-apply
(see `packages/docs/todos/turbo-cache-rollout.md`). The rest of the
cloudflare stack has unrelated pending drift (the gated
`seaweedfs.sjer.red` CNAME destroy), hence `-target` rather than a full
apply from a dev machine.

## Session Log — 2026-07-16

### Done

- Chart/app enablement, helm boilerplate, CI env, dotfiles wiring, 1P items
  (`turbo-cache-r2` + `TURBO_TOKEN` in `buildkite-ci-secrets`), snapshot
  refresh — commits on `feature/turbo-cache-rollout`.
- Updated `todos/turbo-cache-rollout.md` → `waiting-on-verification` with
  the remaining operator steps.
- Prettier-fixed two pre-existing plan docs that failed `//#prettier`.

### Remaining

- Operator: add R2 Edit permission to the Tofu token, then
  `op run --env-file=.env -- tofu -chdir=cloudflare apply -target=cloudflare_r2_bucket.turbo_cache -target=cloudflare_r2_bucket_lifecycle.turbo_cache`.
- Merge PR → ArgoCD deploys; verify remote cache hits locally and in a
  Buildkite turbo summary.
- Optional follow-up: `remoteCache.signature` artifact signing.

### Caveats

- First main build after merge may race the ArgoCD deploy of the cache
  server; turbo treats remote-cache errors as warnings, so builds degrade to
  local cache, not failure.
- `src/resources/turbo-cache.ts` comment updated to reflect the reused
  account-wide keypair; if the credential is ever rotated to a bucket-scoped
  token, only the 1P item fields need updating (names are stable).
