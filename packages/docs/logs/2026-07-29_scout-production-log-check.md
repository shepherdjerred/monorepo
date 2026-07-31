---
id: log-scout-production-log-check-2026-07-29
type: log
status: complete
board: false
---

# Scout Production Log Check

Read-only inspection of Scout production workload state, recent application
logs, and deployed release identity.

## Finding

At 2026-07-29 15:31 PDT, Scout production was unavailable:

- Deployment `scout-prod-scout-backend` had zero available replicas.
- Its only pod was in `CrashLoopBackOff`, with ten restarts and exit code 1.
- Argo CD reported the application `Synced` but `Progressing`, not Healthy.
- The Kubernetes Service had no ready endpoints.
- The public static site and `.release-version` marker returned 200, but
  `/api/ping` and `/api/healthz` returned 502.

Every restart reached the same fatal application error:

```text
Refusing to register /competition: no active LoL seasons defined.
Update SEASONS in packages/scout-for-lol/packages/data/src/seasons.ts.
```

Prisma opened `/data/db.sqlite`, found all 41 migrations, and reported no
pending migrations before the failure. Earlier ZFS CSI mount warnings cleared
before the container started, so storage was not the continuing crash cause.

## Root Cause

Production is pinned lockstep at Scout release `2.0.0-6673`, digest
`sha256:1020003c3939fadb6d4c1bcd0fd362c1ada9865a427d51171fe65528120b33e7`.
The public site marker reports `2.0.0-6673`, and the immutable app bundle embeds
both `2.0.0-6673` and commit `24e5a5e`, so this is not a frontend/backend skew.

Buildkite build 6673 produced that exact digest from commit
`24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc` on 2026-07-27. Its season corpus
ends with Pandemonium Act 2 at 2026-07-28 23:59:59 PDT. The `/competition`
command evaluates its season choices at module load and deliberately terminates
startup when none remain.

The pod restart after the node interruption re-evaluated that expired corpus
and exposed the latent release-data problem. Commit
`7cbac533ac079097b65f4c46d92b8edc35bb9039` added League Classic Act 1 on
2026-07-29, after release 6673 was built. Beta release `2.0.0-7052` includes
that season and is currently Ready; its competition lifecycle job completes
successfully.

## Recovery Boundary

The durable recovery is to promote a minted Scout release containing
`7cbac533a` through the repository/GitOps release flow. Do not patch the live
Deployment directly. After promotion, verify:

1. The prod pod is Ready without restarts.
2. `/api/ping` and `/api/healthz` return success.
3. The backend image and `.release-version` are the same promoted version.
4. Argo CD reports `Synced` and `Healthy`.

League Classic queue/model errors are a separate known issue recorded in
`packages/docs/logs/2026-07-29_scout-league-classic-queue-errors.md`. They do
not cause this startup crash, but rich League Classic notifications will still
need that follow-up after production is restored.

## Session Log — 2026-07-29

### Done

- Captured current pod, Deployment, Service, event, Argo CD, public endpoint,
  Kubernetes log, and Loki evidence without mutating the cluster.
- Identified the deterministic startup error and ruled out migrations,
  persistent storage, and frontend/backend skew as the continuing cause.
- Correlated release `6673` with Buildkite commit `24e5a5e` and confirmed that
  the deployed season corpus expired before the restart.
- Confirmed current main commit `7cbac53` adds League Classic Act 1 and beta
  release `7052` is healthy with the new season.

### Remaining

- None for the requested read-only production log check.

### Caveats

- Production remains down until an authorized post-fix Scout release is
  promoted through GitOps.
- No Kubernetes, Argo CD, GitHub, Buildkite, or Bugsink state was changed.
- League Classic queue/model support remains a separate implementation task.
