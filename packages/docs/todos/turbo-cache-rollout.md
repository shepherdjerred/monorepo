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

## Human Verification

- [ ] Post-deploy: confirm the turbo-cache pod writes `/cache/monorepo/*` (no
      more 412s) and a Buildkite build's turbo summary shows `REMOTE` hits.
      Record evidence in the Comment Log.
- [ ] Operator: delete the now-unused `turbo-cache-r2` 1Password item (Homelab
      (Kubernetes) vault) — no OnePasswordItem CRD references it anymore.
      Refresh the vault snapshot afterward unconditionally: the item is
      already unreferenced, so `check-1password-items.ts` won't flag its
      deletion on its own, and a stale snapshot entry would let a future
      accidental reference to the deleted item pass CI despite failing at
      deployment.
- [ ] Operator: revoke the account-wide **Workers R2 Storage → Edit**
      permission added to the "Cloudflare API Token (Tofu - Full)" token for
      this rollout (`packages/docs/logs/2026-07-16_turbo-cache-rollout.md`
      lines 40-46, 69-73). Removing `src/tofu/cloudflare/turbo-cache.tf` was
      the last `cloudflare_r2_*` resource using that permission — leaving it
      in place would let compromise of the general CI Tofu credential mutate
      unrelated R2 data (e.g. the Velero backup bucket).
- [ ] Consider enabling artifact signing (`remoteCache.signature: true` in
      `turbo.json` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on clients and
      server).
