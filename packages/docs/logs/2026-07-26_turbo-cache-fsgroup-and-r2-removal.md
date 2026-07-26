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

- cdk8s `build test` green; rendered `dist/apps.k8s.yaml` shows
  `securityContext: {fsGroup: 1001}` on turbo-cache.
- `tofu -chdir=cloudflare init -backend=false && tofu validate` green after
  removing the file.
- Post-deploy: turbo-cache pod writes `/cache/monorepo/*` successfully; a
  Buildkite build's turbo summary shows `REMOTE` hits.
