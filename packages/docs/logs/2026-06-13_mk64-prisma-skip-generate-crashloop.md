---
id: log-2026-06-13-mk64-prisma-skip-generate-crashloop
type: log
status: complete
board: false
---

# MK64 prod crashloop — Prisma 7 `db push --skip-generate` + smoke-test gap

## Symptom

`mario-kart` deployment in `CrashLoopBackOff` on image `2.0.0-3921` (the
leaderboards image from PR #1143). Pod `0/1 Error`, restarting every ~30s. Pokemon
was healthy (`1/1 Running`, same build) — unaffected.

## Root cause

The deployed image's entrypoint (Dagger, `.dagger/src/image.ts`) ran:

```
sh -c "cd packages/backend && bunx prisma db push --skip-generate && \
       cd /workspace/packages/discord-plays-mario-kart && \
       exec bun packages/backend/src/index.ts"
```

mario-kart pins **Prisma 7.8.0**. **Prisma 7 removed `--skip-generate` from
`db push`** (generate is decoupled). The live pod's own usage output lists only
`--help/--config/--schema/--url/--accept-data-loss/--force-reset`. So
`prisma db push --skip-generate` exited 1 → the `&&` chain short-circuited →
`index.ts` never started → CrashLoopBackOff. Leaderboards (PR #1143) introduced the
Prisma DB + this boot-time push; the flag was written for Prisma 6 semantics.

## Why the smoke test missed it

`smokeTestDiscordPlaysMarioKartHelper` (`.dagger/src/misc.ts`) did
`.withEntrypoint([])` — **clearing the real entrypoint** — then ran
`bun packages/backend/src/index.ts` directly. The `prisma db push` prelude was
never executed, so a broken migration command was invisible. `runSmokeTest` passes
on seeing `TokenInvalid`/`401`, which `index.ts` emits regardless.

## Fix

1. **`.dagger/src/image.ts`** — dropped `--skip-generate`; extracted the command
   into module-scope `MARIO_KART_ENTRYPOINT_COMMAND` (+ `MARIO_KART_INNER_ROOT`) so
   the image entrypoint and the smoke test share one source of truth and can't
   drift.
2. **`packages/discord-plays-mario-kart/Dockerfile`** — same `--skip-generate`
   removal (local-iteration parity; not the canonical build).
3. **`.dagger/src/misc.ts`** — hardened the smoke test to run the **real entrypoint
   command** (`MARIO_KART_ENTRYPOINT_COMMAND`) under a 30s timeout, with
   `DATABASE_PATH=/tmp/smoke-leaderboard.db`. A broken migration command now exits
   non-zero with the prisma error (no `TokenInvalid`) → `runSmokeTest` throws → CI
   red. This prevents the entire class of "entrypoint-prelude breakage invisible to
   smoke" regressions for mario-kart.
4. **`packages/homelab/src/cdk8s/src/resources/mario-kart.ts`** — `replicas: 0 → 1`
   (mario-kart should run on the fixed image).

## SQLite PVC — already correct (verified)

The leaderboard DB is already persisted on a PVC: `mario-kart-data-volume`
(`ZfsNvmeVolume` → real `PersistentVolumeClaim`, `zfs-ssd`, 1Gi, RWO) mounted at
`${APP_ROOT}/data`; `DATABASE_PATH=${APP_ROOT}/data/leaderboard.db` puts the DB on
it; Velero-backed; `Recreate` strategy (correct for RWO single-writer SQLite). The
restored pod's log confirms it end-to-end:
`SQLite database leaderboard.db created at file:/workspace/.../data/leaderboard.db`.
No change needed.

## Live mitigation (applied)

`kubectl patch` overrode the deployment's `containers[0].command` to drop
`--skip-generate`, then scaled to `replicas: 1`. Pod went `1/1 Running` (0
restarts); `prisma db push` succeeded ("🚀 Your database is now in sync … Done in
239ms"), bot logged in, emulator running, leaderboards enabled. ArgoCD has no
selfHeal, so the override persists until the next chart sync.

## Verification

- `.dagger` typecheck (`dagger develop` to gen SDK, then `tsc --noEmit`) — exit 0.
- Live pod is the end-to-end proof the fixed command works in the real image (it
  runs the exact `MARIO_KART_ENTRYPOINT_COMMAND` the smoke test now exercises).
- CI runs the hardened smoke test on the PR (full image build).

## Session Log — 2026-06-13

### Done

- Diagnosed the `mario-kart` CrashLoopBackOff: Prisma 7 rejecting
  `db push --skip-generate` in the image entrypoint.
- Live-restored service: `kubectl patch` command override (drop flag) + scale to 1
  → `1/1 Running`.
- Permanent fix on `feature/mk64-prisma-skip-generate`: image.ts entrypoint +
  shared constant, Dockerfile, hardened smoke test, cdk8s `replicas: 1`.
- Confirmed the SQLite leaderboard DB is already PVC-backed (no change needed).

### Remaining

- Merge the PR; CI builds a new image (no `--skip-generate`) and version-commit-back
  fills the digest into `versions.ts`; ArgoCD syncs.
- **Post-deploy cleanup:** once the new image is live, remove the manual
  `containers[0].command` override drift on the deployment
  (`kubectl patch ... op:remove /spec/template/spec/containers/0/command`) so the
  fixed image entrypoint takes over. (The chart sets no `command`, so a 3-way merge
  won't strip the drift automatically.)

### Caveats

- The live `command` override is functionally identical to the fixed entrypoint, so
  it's harmless if not removed immediately — but it is drift and should be cleaned
  up post-deploy.
- The `logs` emptyDir bridge in `mario-kart.ts` (winston File-transport workaround)
  is still present; orthogonal to this fix.
