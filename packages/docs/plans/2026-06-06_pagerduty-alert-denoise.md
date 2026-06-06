# Plan: Fix / de-noise four PagerDuty homelab alerts

## Status

Complete (pending CI + deploy)

## Context

Four PagerDuty incidents on the Homelab service needed either a proper root-cause fix or an
alert/threshold tweak. Investigation (read-only, against live `admin@torvalds`) classified them and
this change implements the fixes. All code edits are in `packages/homelab`; one PR.

| Incident(s)                             | Verdict             | Action taken                                                                                                                                            |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5383 / 5384 Velero orphan ZFS snapshots | Real                | Manual cleanup (operational) + `Prune=false` on Schedule CRs; auto-prune **declined** (too risky for backups); docs record the TTL-finalizer recurrence |
| 5335–5339 Large-PVC backup              | Noise               | Export velero labels via KSM allowlist, rewrite alert to "undecided large PVC", Kyverno-label the 3 excluded PVCs                                       |
| 5398 TaskNotes restarted                | Noise               | Alert on CrashLoopBackOff, not clean rollouts                                                                                                           |
| 5332 runVacuumIfNotHome skipping        | Working as designed | Reason-aware: count only anomalous skips                                                                                                                |

User decisions: no auto-prune for orphans; reason-aware vacuum alert; exclude seaweedfs from backup.

## Changes

### Fix 1 — Orphan ZFS snapshots (5383 / 5384)

Root cause: 31 orphans, all suffix `@monthly-backup-20260301050003` — one monthly backup's 90-day TTL
expired ~2026-05-30 and the openebs-zfs `DeleteSnapshot` finalizer failed to destroy the ZFS
snapshots. Distinct from the 2026-03 re-deploy mode.

- `argo-applications/velero.ts` — `argocd.argoproj.io/sync-options: Prune=false` on the Velero
  `Schedule` CRs (guards the re-deploy mode).
- `decisions/2026-05-05_velero-orphan-snapshot-prevention.md` — recurrence section; auto-prune
  declined; Prune=false marked done.
- `guides/2026-05-05_velero-orphan-snapshot-remediation.md` — same-suffix orphan set = TTL-finalizer
  signature.
- **Operational (manual, needs go-ahead):** `zfs destroy` the 31 orphans via the runbook, then
  re-trigger `velero-orphan-audit`. Not part of the PR.

### Fix 2 — Large-PVC backup alerts (5335–5339) — SUPERSEDED by main

**Dropped in the 2026-06-06 merge.** While this PR was open, `main` independently fixed the same
alert with a different mechanism: an explicit `REVIEWED_LARGE_PVC_BACKUP_POLICY_MATCHERS` allowlist of
(namespace, pvc) pairs in `monitoring/rules/velero.ts` (the alert fires `unless` the PVC is in that
reviewed list). When merging `origin/main` into this branch the conflict was resolved by taking main's
version and backing out this PR's now-redundant label-based scaffolding (the KSM `metricLabelsAllowlist`
in `prometheus.ts`, the `PrometheusValuesWithBlackbox` type extension in `grafana-values.ts`, and the
`exclude-large-bulk-pvcs` Kyverno rule). The incident is resolved by main's approach; no PVC labeling
or one-time `kubectl label` is needed.

Original (now-dropped) approach was: export velero.io labels via kube-state-metrics + rewrite the alert
to fire only for an undecided large PVC + Kyverno-label the excluded PVCs.

### Fix 3 — TaskNotes restart alert (5398)

`monitoring/rules/tasknotes.ts` — replace `TasknotesContainerRestarted` (any restart) with
`TasknotesContainerCrashLooping` on `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}`.
Clean rollouts never enter CrashLoopBackOff.

### Fix 4 — runVacuumIfNotHome skip alert (5332)

`monitoring/rules/temporal.ts` — replace the single generic outcomes rule with config-driven
per-workflow rules (`CHECK_AND_SKIP_WORKFLOWS`) that exclude benign skip reasons, plus a generic
fallback for unconfigured workflows. Vacuum benign reasons: `someone-home`, `vacuum-state-cleaning`,
`vacuum-state-returning` (error/unavailable/unknown still page). goodMorning\*: `no-one-home`.

## Verification

- `bun run --filter='./packages/homelab' typecheck` — passed (KSM type compiles without `as`).
- `bun run --filter='./packages/homelab' lint` — see CI.
- Post-deploy (live): `toolkit gf query 'kube_persistentvolumeclaim_labels{label_velero_io_backup!=""}'`
  returns labeled PVCs; rewritten large-PVC expr returns empty; CrashLoopBackOff / anomalous-vacuum-skip
  / unlabeled-300Gi-PVC still fire in a rule preview.
- After manual orphan cleanup: `velero_orphan_local_snapshots_total == 0`; 5383/5384 resolve.

## Session Log — 2026-06-06

### Done

- Implemented all 4 fixes in `packages/homelab` (files above); homelab typecheck green.
- Branch `fix/pagerduty-alert-denoise` (worktree `.claude/worktrees/pagerduty-alert-fixes`).
- Investigation summary for all 16 incidents delivered in chat (4 parallel agents).

### Remaining

- Open PR; get Buildkite CI green.
- **Operational, needs user go-ahead:** prune the 31 orphan ZFS snapshots (runbook); one-time
  `kubectl label` the 3 excluded PVCs; resolve PD incidents once each fix deploys (needs user PD email
  for `From`).
- Out of scope (separate): NVMe temp 5400 / SSD writes 5404 (cooling + tmpfs), HA outage 5405 +
  SmartThings re-auth, physical chores (5345/5376/5386/5396).

### Caveats

- `Prune=false` is applied to Schedule CRs only; BSL/VSL are Helm-rendered and can't be annotated
  without forking — the documented "drain backups before re-deploy" procedure remains the primary
  re-deploy guard. The TTL-finalizer recurrence stays detection + manual by design (auto-prune declined).
- Kyverno labels apply on admission; existing PVCs need the one-time `kubectl label` to clear the alert
  now.
