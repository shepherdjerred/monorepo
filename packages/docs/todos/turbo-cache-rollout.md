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
- ✅ **Dev token consumer retargeted** (`2026-07-26`): the dev-shell
  `TURBO_TOKEN` in `config.fish.tmpl` read from the `turbo-cache-r2` item
  (`jdhq6ptnbds2x55fshah6n2hyi`), the same item the operator step below
  deletes — deleting it first would have broken every dev machine's remote
  cache auth. Retargeted to the shared `buildkite-ci-secrets` item
  (`rzk3lawpk4yspyyu5rxlz44ssi`, same vault), which already carries the same
  `TURBO_TOKEN` value.

## Human Verification

- [ ] Post-deploy: confirm the turbo-cache pod writes `/cache/monorepo/*` (no
      more 412s) and a Buildkite build's turbo summary shows `REMOTE` hits.
      Record evidence in the Comment Log.
- [ ] Operator: after `chezmoi apply`, confirm dev-shell `$TURBO_TOKEN` is
      still populated (now sourced from `buildkite-ci-secrets`) before
      proceeding — then delete the now-unused `turbo-cache-r2` 1Password item
      (Homelab (Kubernetes) vault). No OnePasswordItem CRD references it
      anymore and the dev-shell template no longer does either. Refresh the
      vault snapshot afterward unconditionally: the item is already
      unreferenced, so `check-1password-items.ts` won't flag its deletion on
      its own, and a stale snapshot entry would let a future accidental
      reference to the deleted item pass CI despite failing at deployment.
- [ ] Operator: **only after** a `tofu-cloudflare` Buildkite step
      (`.buildkite/pipeline.yml`, runs post-merge on `main`) has successfully
      applied the `turbo-cache.tf` removal and destroyed the bucket, revoke
      the account-wide **Workers R2 Storage → Edit** permission on the
      "Cloudflare API Token (Tofu - Full)" token added for this rollout
      (`packages/docs/logs/2026-07-16_turbo-cache-rollout.md` lines 40-46,
      69-73). That token previously 403'd on all R2 endpoints without this
      permission, so revoking it before the destroy apply runs would fail the
      apply and leave the bucket in state. Once revoked, the general CI Tofu
      credential no longer retains unnecessary mutation access to unrelated
      R2 data (e.g. the Velero backup bucket).
- [ ] Consider enabling artifact signing (`remoteCache.signature: true` in
      `turbo.json` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` on clients and
      server).
