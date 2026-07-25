---
id: turbo-cache-rollout
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-13_ci-parity-implementation.md
---

# Roll out the turbo remote-cache server

Most operator steps completed 2026-07-16 (see
`packages/docs/logs/2026-07-16_turbo-cache-rollout.md`):

- ✅ 1Password item `turbo-cache-r2` created (Homelab (Kubernetes) vault).
  S3 keypair **reuses the account-wide "CloudFlare R2" token** — operator
  decision 2026-07-16, chosen over minting a bucket-scoped token. The
  bucket-scoped comment in `src/resources/turbo-cache.ts` describes the
  original design, not what's deployed.
- ✅ `TURBO_TOKEN` added to the `buildkite-ci-secrets` item; snapshot
  refreshed and committed.
- ✅ Chart + Argo app uncommented; `helm/turbo-cache/` boilerplate added.
- ✅ CI env (`TURBO_API` in-cluster service DNS + `TURBO_TEAM`) in
  `.buildkite/pipeline.yml`; dev shells via `config.fish.tmpl` (tailnet
  ingress URL).

- ✅ R2 bucket + lifecycle applied (2026-07-16, targeted apply after the
  operator added **Account → Workers R2 Storage → Edit** to the
  "Cloudflare API Token (Tofu - Full)" token in-place — it previously had NO
  R2 permission and 403'd on all R2 endpoints, which would also have broken
  CI's `tofu apply (cloudflare)`). S3 put/get/delete round-trip on the
  bucket verified with the reused keypair.
- ✅ `TURBO_TOKEN` confirmed synced into the live `buildkite-ci-secrets`
  k8s secret by the 1Password operator.

Remaining:

1. Merge the PR; ArgoCD deploys the server. The merge build's own `verify`
   step runs before the server exists — turbo logs remote-cache warnings and
   falls back to local cache; builds from then on use the remote cache.
2. Verify end-to-end: `bunx turbo run build --filter=<pkg> --force` twice on a
   dev machine → second run should log remote cache hits; check a Buildkite
   build's turbo summary for `REMOTE` hits.
3. Consider enabling artifact signing (`remoteCache.signature: true` in
   `turbo.json` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on clients and server).

## Human Verification

- Verify `Roll out the turbo remote-cache server` in its intended environment and record evidence in the Comment Log.
