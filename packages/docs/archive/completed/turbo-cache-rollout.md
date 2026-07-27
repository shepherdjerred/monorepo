---
id: turbo-cache-rollout
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-13_ci-parity-implementation.md
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

## Remaining

- [x] Confirm the deployed server accepts artifact writes without 412 responses and record one Buildkite turbo summary with a `REMOTE` cache hit.
- [x] Record the cache object path, build identifier, and observation time in the Comment Log.

Privileged credential cleanup is tracked separately in
`turbo-cache-privileged-cleanup`. The optional signing design is tracked in
`turbo-cache-artifact-signing`.

## Comment Log

### 2026-07-27 — Awaiting-human audit

PR #1526 deployed the server and PR #1696 added `fsGroup: 1001` while removing
the R2 backend. The remaining cache-hit proof is a deterministic production
observation and is now agent-owned.

### 2026-07-27 — Production verification

Buildkite main build #6529 passed at `2026-07-27T19:35:05Z`. Its verify job ran
on liskov with remote
caching enabled and reported 191 successful tasks, 186 cached tasks, and a
57.159-second runtime from the fresh CI checkout. At
`2026-07-27T19:42:02.109Z`, Loki request ID
`l9figggnRE66ybEXcaNerA-1975` recorded
`PUT /v8/artifacts/c769fca7298f201b?slug=monorepo` followed by HTTP 200 in
0.824 ms. The deployment therefore accepts writes and serves the cache used by
CI; optional signing and privileged credential cleanup remain separate cards.
