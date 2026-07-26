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

Server deployed and reachable (in-cluster `TURBO_API`, tailnet ingress for dev
shells). The storage backend moved from Cloudflare R2/S3 to a **local NVMe PVC**
(`STORAGE_PROVIDER=local`, `turbo-cache-liskov`). See
`packages/docs/logs/2026-07-16_turbo-cache-rollout.md` (initial rollout) and
`2026-07-26_turbo-cache-fsgroup-and-r2-removal.md` (local-backend fix + R2
teardown).

- ✅ `TURBO_TOKEN` in `buildkite-ci-secrets`, synced into the k8s secret;
  snapshot refreshed. Chart + Argo app live; CI env + dev-shell URL wired.
- ✅ **Local backend made writable** (`2026-07-26`): the server runs as uid/gid
  1001 but a fresh PVC root is root:root, so every artifact PUT 412'd with
  `EACCES: mkdir /cache/monorepo`. Fixed by `securityContext.fsGroup: 1001` on
  the Deployment.
- ✅ **R2 removed** (`2026-07-26`): `src/tofu/cloudflare/turbo-cache.tf` deleted
  (bucket emptied first so `tofu apply` deletes it cleanly). R2 was the backend
  only until the local cutover; nothing writes to it now.

Remaining:

1. Post-deploy: confirm the turbo-cache pod writes `/cache/monorepo/*` (no more
   412s) and a Buildkite build's turbo summary shows `REMOTE` hits.
2. Operator: delete the now-unused `turbo-cache-r2` 1Password item (Homelab
   (Kubernetes) vault) — no OnePasswordItem CRD references it anymore. Refresh
   the vault snapshot afterward if the linter flags it.
3. Consider enabling artifact signing (`remoteCache.signature: true` in
   `turbo.json` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on clients and server).

## Human Verification

- Confirm remote cache hits end-to-end after the fsGroup fix deploys, and that
  R2 teardown applied without breaking `tofu apply (cloudflare)`. Record
  evidence in the Comment Log.
