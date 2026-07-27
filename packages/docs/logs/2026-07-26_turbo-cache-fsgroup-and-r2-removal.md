---
id: turbo-cache-fsgroup-and-r2-removal
type: log
status: in-progress
board: false
---

# turbo-cache: fix write-dead local PVC (fsGroup) + remove old R2/S3 backend

Follow-up to [[turbo-cache-orphan-prune]] and the local-storage cutover. While
getting main build 6365 green (a transient `@lng2004/node-datachannel`
`prebuild-install` timeout in `verify`, cleared by a job retry), the turbo
remote cache was found to be **write-dead**.

## Diagnosis (evidence from the live pod)

CI turbo logs were full of:

```
WARNING failed to contact remote cache: HTTP status client error (412 Precondition Failed)
  for url (http://turbo-cache-…svc.cluster.local:3000/v8/artifacts/<hash>?slug=monorepo)
```

`kubectl logs -n turbo-cache deploy/turbo-cache` showed the server-side cause on
every artifact **PUT**:

```
EACCES: permission denied, mkdir '/cache/monorepo'
→ put-artifact.ts throws → HTTP 412 Precondition Failed
```

`kubectl exec` confirmed the permission mismatch:

- container runs as **uid=1001(app) gid=1001(app)** (ducktors image default)
- `/cache` PVC mount owned by **root:root, mode 0755** — no group/other write
- `mkdir /cache/testdir` → `Permission denied`
- PVC otherwise **empty** (`total 1`) — **no artifact has ever been written**
  locally; every CI build is a 100% remote-cache miss.

Reads return 200/404 fine; only writes fail. Root cause: the write-reduction
cutover flipped `STORAGE_PROVIDER` to `local` on a fresh NVMe PVC whose root is
created root:root; a non-root container can't create subdirs. Under the old
R2/S3 backend there was no local `mkdir`, so it never surfaced.

## Old R2/S3 backend — confirmed removable

`aws s3 ls s3://turbo-cache/ --recursive --profile r2` → **14,192 objects /
12.9 GiB**, newest write 2026-07-25 (R2 was the backend until the ~2026-07-26
local cutover). Server env is now `STORAGE_PROVIDER=local`, so nothing writes to
R2 anymore. The only references to the bucket are
`src/tofu/cloudflare/turbo-cache.tf` (bucket + 30-day lifecycle) and docs.

## Plan

1. **fsGroup fix** — `securityContext: { fsGroup: 1001 }` on the turbo-cache
   Deployment (`src/cdk8s/src/resources/turbo-cache.ts`). Kubelet chgrps the
   volume to gid 1001 + group-writable on mount, so `app` can create
   `/cache/monorepo`. Matches the golink/mario-kart/temporal fsGroup idiom.
   Also drop the stale bucket-scoped-token comment (design no longer deployed).
2. **Remove old S3 cache** — empty the R2 bucket
   (`aws s3 rm s3://turbo-cache/ --recursive --profile r2`) **before** merge so
   `tofu apply (cloudflare)` won't fail on a non-empty bucket, then delete
   `src/tofu/cloudflare/turbo-cache.tf`.
3. Flag the operator-owned `turbo-cache-r2` 1Password item for deletion (no
   longer referenced by any OnePasswordItem CRD).
4. Update/close the `turbo-cache-rollout` todo (local path is the chosen design;
   R2 removed).

## Verification target

- cdk8s `build test` green; rendered `dist/turbo-cache.k8s.yaml` (the
  `createTurboCacheChart` chart, not `dist/apps.k8s.yaml`) shows
  `securityContext: {fsGroup: 1001}` on the turbo-cache Deployment.
- `tofu -chdir=cloudflare init -backend=false && tofu validate` green after
  removing the file.
- Post-deploy: turbo-cache pod writes `/cache/monorepo/*` successfully; a
  Buildkite build's turbo summary shows `REMOTE` hits.

## Session Log — 2026-07-26

### Done

- Diagnosed the write-dead local turbo-cache PVC (root:root mount, uid/gid
  1001 container) and fixed it with `securityContext.fsGroup: 1001` on the
  Deployment in `packages/homelab/src/cdk8s/src/resources/turbo-cache.ts`
  (`createTurboCacheDeployment`; the chart file at
  `src/cdk8s/src/cdk8s-charts/turbo-cache.ts` only registers the chart and
  calls that function). Dropped the stale bucket-scoped-token comment.
- Emptied the R2 bucket (`aws s3 rm s3://turbo-cache/ --recursive --profile
r2`) and deleted `src/tofu/cloudflare/turbo-cache.tf`.
- Updated `packages/docs/todos/turbo-cache-rollout.md` to reflect the local
  backend and R2 teardown, and restructured its pending work into a
  `## Human Verification` checklist (the plain `Remaining:` prose list wasn't
  a recognized `## Remaining` heading, so docs-board tooling was reporting
  zero pending items on an `awaiting-human` doc).
- Set `fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH` alongside
  `fsGroup` on the Deployment (default is `ALWAYS`, which would recursively
  relabel the whole 256 GiB PVC on every restart once it's populated).
  Matches the seerr/bindery/jellyfin idiom.
- Found and fixed a real breakage the 1Password-deletion checklist item would
  have caused: `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl`
  reads the dev-shell `TURBO_TOKEN` from the `turbo-cache-r2` item
  (`jdhq6ptnbds2x55fshah6n2hyi`) — deleting that item per the todo would break
  remote-cache auth on every dev machine, since only OnePasswordItem CRDs were
  checked for references, not this non-Kubernetes consumer. Retargeted the
  template to the shared `buildkite-ci-secrets` item
  (`rzk3lawpk4yspyyu5rxlz44ssi`), which already holds the same token value.
- Made the Workers R2 Storage → Edit permission revocation explicitly
  contingent on the post-merge `tofu-cloudflare` Buildkite step actually
  destroying the bucket first — that token 403'd on all R2 endpoints without
  the permission, so revoking it before the destroy apply runs would fail the
  apply and strand the bucket.
- cdk8s `build test` and `tofu validate` (backend disabled) both green
  locally.

### Remaining

- All outstanding follow-ups (post-deploy cache-hit confirmation, deleting the
  `turbo-cache-r2` 1Password item + snapshot refresh, revoking the
  now-unnecessary Workers R2 Storage → Edit permission on the shared Tofu
  token, and considering artifact signing) are tracked as a checklist in
  `packages/docs/todos/turbo-cache-rollout.md`'s `## Human Verification`
  section, now with the correct ordering dependencies between them.
- The live `~/.config/fish/config.fish` on this machine still has the
  rendered (pre-retarget) `TURBO_TOKEN` value baked in from a prior `chezmoi
apply`. Not edited here — it holds a resolved secret value, not the
  template, and I didn't want to touch 1Password-derived state without the
  operator present. Re-running `chezmoi apply` after this PR merges will
  pick up the new source item (value is unchanged, so it's a no-op unless the
  old item is deleted first).

### Caveats

- This fix hasn't been observed live yet; the fsGroup change is validated by
  chart synthesis only, not by a real cache write. Treat the todo's "Human
  Verification" section as the source of truth until that's confirmed.
