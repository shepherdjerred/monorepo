# PagerDuty Cleanup

## Status

Complete

## Context

PagerDuty had stale incidents for removed or already-fixed alerts, and the
status-page project was no longer live. The cleanup also covered the released
PV alert, the Velero orphan-audit alert expression, and the Birmel image smoke
test gap that missed the production Prisma startup failure.

## Session Log - 2026-05-13

### Done

- Created a fresh dissociated clone at
  `/Users/jerred/git/monorepo-pagerduty-cleanup` and implemented the cleanup on
  branch `feature/pagerduty-cleanup`.
- Committed the implementation and opened draft PR #800.
- Removed the stale status-page project and active deployment/static-site/S3
  bucket references from `poc/status-page`, homelab cdk8s, SeaweedFS Tofu, CI
  chart catalog, image versions, and active docs.
- Fixed `ReleasedPVsAccumulating` to sum released PV gauges instead of counting
  all matching PV series.
- Fixed `VeleroOrphanAuditNotRunning` to use `absent_over_time(...)` over the
  36h lookback instead of `absent(rate(...) > 0)`.
- Fixed Birmel production startup to run `prisma generate` before `prisma db
push`, and changed the Birmel smoke test to exercise the same Prisma startup
  command with a regression test.
- Verified with `bun run typecheck` and `bun run test` in
  `packages/homelab/src/cdk8s`, `bun run typecheck` and `bun test` in
  `scripts/ci`, `bun scripts/check-dagger-hygiene.ts`, SeaweedFS Tofu
  `fmt -check`, cdk8s ESLint, and `dagger call smoke-test-birmel ...`.
- Deleted released PV `restored-d89486b5-32ba-42d7-a636-cc6bddb0c5e6`, its
  OpenEBS ZFSVolume, and backing dataset
  `zfspv-pool-nvme/restored-d89486b5-32ba-42d7-a636-cc6bddb0c5e6`.
- Resolved PagerDuty incidents #4486, #4496, and #4521 after confirming they no
  longer matched live Alertmanager alerts.

### Remaining

- Merge/deploy the branch so `status.sjer.red`, Velero orphan-audit, and Birmel
  fixes reach the cluster; those PagerDuty incidents were left open because
  Alertmanager still reports them active.
- Triage the new live hardware/storage alerts opened during the session:
  #4618-#4625.

### Caveats

- Root-level ESLint is not configured for `.dagger` or `scripts/ci`; those
  changes were verified by typecheck/tests and the Dagger hygiene checker
  instead.
- PagerDuty still has live incidents for disk writes/temperature/ZFS/Birmel and
  the undeployed status/Velero fixes. Closing those now would risk immediate
  re-triggering.
