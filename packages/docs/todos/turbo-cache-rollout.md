---
id: turbo-cache-rollout
status: waiting-on-verification
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

Remaining:

1. **R2 bucket apply is blocked on token permissions.** The
   "Cloudflare API Token (Tofu - Full)" token has NO R2 permission —
   `POST /r2/buckets` and even R2 reads return 403. Operator must add
   **Account → Workers R2 Storage → Edit** to that token in the Cloudflare
   dashboard, then run
   `op run --env-file=.env -- tofu -chdir=cloudflare apply -target=cloudflare_r2_bucket.turbo_cache -target=cloudflare_r2_bucket_lifecycle.turbo_cache`
   from `packages/homelab/src/tofu`. Without this, CI's
   `tofu apply (cloudflare)` step will also fail post-merge.
2. Merge the PR; ArgoCD deploys the server.
3. Verify end-to-end: `bunx turbo run build --filter=<pkg> --force` twice on a
   dev machine → second run should log remote cache hits; check a Buildkite
   build's turbo summary for `REMOTE` hits.
4. Consider enabling artifact signing (`remoteCache.signature: true` in
   `turbo.json` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on clients and server).
