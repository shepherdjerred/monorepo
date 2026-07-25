---
id: 2026-07-25-pagerduty-incident-triage
type: log
status: complete
board: false
---

# PagerDuty triage: scout weekly-report alert, Buildkite job failure, control-plane crash loops

Investigated open PagerDuty incidents 6738, 6753, 6754, 6755, 6756 (user excluded 6750
Home Assistant and 6751 SSD-wear from scope). No code or infra changes were made — this
session is diagnosis only.

## 6738 — ScoutScheduledReportMissedWeekly [scout-prod] (x7)

- Prod metric state (`scout_scheduled_report_last_success_timestamp_seconds{environment="prod"}`):
  Daily Board (id 234) healthy (last success 2026-07-25 00:00 UTC), but **Weekly Board (235) and
  all 7 COMMON_DENOMINATOR reports (236–242) are seeded at epoch 0** — the "never ran" sentinel.
  With the alert expr `time() - last_success > 698400`, epoch-0 rows are an always-firing condition.
- Report IDs climbed from 123–129 (2026-07-09 investigation, `logs/2026-07-09_scout-pd-alert.md`)
  to 236–242 — the daily wipe/recreate cycle continued after 7/9. The wipe cycle **has stopped**:
  Loki (7-day window) shows zero `Removing data`/`confirmed removed` events, and prod
  (2.0.0-5991, promoted via PR #1567 on 2026-07-19) runs the fixed reconciler from
  PR #1429 (merged 2026-07-11) — the two-strike confirm logic is visibly logging.
- Current rows were created during the pre-promotion wipe era and have simply never had a
  Sunday 18:00 UTC run succeed since creation (the 7/19 cutover landed the same day as the
  weekly cron; Loki retention doesn't reach far enough to see exactly why that tick was missed).
  **Next scheduled run: Sunday 2026-07-26 18:00 UTC — the alert should self-heal then.**
- **CORRECTION (same session, deeper dig):** the 10004 is NOT transient — **the prod bot
  (application 1182800769188110366) is genuinely no longer a member of Diamond Dudes.**
  Verified live: `GET /guilds/1337623164146155593` with the prod bot token → 404/10004, and the
  guild is absent from its `GET /users/@me/guilds` list (54 guilds, none of them Diamond Dudes).
  The **beta bot is a different application (1311755320745394317) and IS still in the guild**
  (HTTP 200) — which is why beta's weekly reports succeed. The hourly `validate-data`
  "all guilds valid" was a red herring: it only checks guilds with `Subscription` rows, and the
  home guild has none.
- Log evidence: Sunday 2026-07-19 18:00 UTC dispatcher skipped all 7 weekly reports with
  `bot is not a member of guild 1337623164146155593` (report IDs 193–199 then), and the
  **old pre-fix reconciler wiped + resynced the 7 reports daily at 04:00 UTC from 7/19 through
  7/24** (`Cleaned removed guild … reports: 7` each day — old file line numbers 24/77/87).
  The fixed reconciler (PR #1429 code) only reached prod ~2026-07-24 23:51 UTC (5991 rollout;
  first run skipped on empty cache), and its first real run today recorded strike one.
  These wipes were _true_ positives — the bot really is gone; the July 9 "false positive"
  framing no longer applies to the current situation.
- **SECOND CORRECTION (operator input): the prod bot's absence is intentional** — the user
  serves Diamond Dudes with the **beta** environment on purpose. The prod bot should NOT be
  re-invited. The actual defect is that prod 2.0.0-5991 still runs the pre-2026-07-12 code
  that re-seeds COMMON_DENOMINATOR system reports into `MY_SERVER` (hardcoded in
  `configuration/flags.ts:65`) — a guild prod deliberately isn't in — so the rows churn
  daily and the alert can never clear.
- **Real fix: promote prod.** CD seeding was retired in #1508 (966e2835e, merged 2026-07-12;
  `syncSystemReports` now only seeds competition-linked reports). The standing promotion PR
  **#1617 (prod → 2.0.0-6100)** contains both the reconciler fix and the retirement. After it
  merges and deploys: the two-strike reconcile correctly wipes the orphaned report rows once,
  nothing re-seeds them, the `scout_scheduled_report_last_success_timestamp_seconds`
  COMMON_DENOMINATOR series disappear, and alert 6738 clears permanently. No code change
  needed. (Note: PRs #1630/#1632 are concurrently reworking the promotion mechanism via
  Renovate — whichever path lands, prod just needs to reach a build ≥ #1508.)

## 6753 — Job failed to complete [buildkite] (auto-resolved)

- Not infra. Pod `buildkite-019f9a7a-...-vjm6k` (PR #1628, commit a5019ed57) failed the
  **Trivy image scan with exit status 7** — HIGH vulns:
  - `brace-expansion` 5.0.7 → fixed 5.0.8 (CVE-2026-14257, ReDoS)
  - `postcss` 8.5.16 → fixed 8.5.18 (GHSA-r28c-9q8g-f849, path traversal)
  - `react-router` 7.18.1 → fixed 8.3.0 (GHSA-qwww-vcr4-c8h2, CSRF bypass; major bump)
- Fix is dependency bumps in the affected image(s) on PR #1628's stack.

## 6754 / 6755 / 6756 — crash loops (intel-device-plugin-operator, kube-system, argocd)

One shared root cause, not three bugs:

- `argocd-image-updater` (355 restarts/7d18h), `inteldeviceplugins-controller-manager`
  (359 restarts/7d18h), `kube-controller-manager-torvalds` + `kube-scheduler-torvalds`
  (54/57 restarts/3d20h) all exit with **"Failed to renew lease … context deadline exceeded"**
  at the same instant (e.g. 18:21:42 UTC across all of them). Losing leader election is a
  deliberate process exit for controller-runtime binaries — kubelet then restarts them and
  backoff makes it look like CrashLoopBackOff.
- kube-apiserver logs at the same timestamps: etcd client `Range`/`Txn` cancellations and
  `http: Handler timeout` on lease PUTs across many namespaces; kyverno webhook simultaneously
  connection-refused (it was dying of the same stall, failing closed).
- Lease-flap events recur roughly every 8–9 minutes. etcd itself reports healthy
  (512 MB db, no errors), no kernel disk errors in dmesg → not failing hardware, but
  **I/O starvation: top disk writers are Buildkite CI pods on the same node (one at ~42 MB/s
  sustained)**. Single-node cluster (torvalds) shares one disk between etcd and CI scratch;
  heavy CI write bursts stall etcd fsync → apiserver 5s lease requests time out → every
  leader-elected component loses its lease at once.
- This is the same underlying issue as excluded incident 6751 ("sustained disk write activity —
  SSD wear"), which is best read as the cause-side alert of these symptom-side crash loops.
- Remediation directions (not implemented): move Buildkite workspace/scratch to a separate
  device or PV, apply I/O limits to CI pods, reduce concurrent agents, and/or relax
  leader-election timeouts (leaseDuration/renewDeadline) for the homelab's single-node reality.
  The wear alert (6751) argues for fixing the write volume, not just the timeouts.

## Session Log — 2026-07-25

### Done

- Triaged 5 PagerDuty incidents to root cause (details above).
- 6753 confirmed auto-resolved (lived 11:18–11:23 AM PT; the underlying Trivy failure on
  PR #1628 is still real).
- Per user direction ("we shouldn't get PagerDuty alerts for a CI failure"): added an
  Alertmanager null-route for `KubeJobFailed` scoped to `namespace="buildkite"` in
  `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts`, with routing
  guard tests in `pagerduty-alerting.test.ts` (buildkite → null, other namespaces still
  page). PR #1631.

### Remaining

- Merge PR #1631 (deploys via ArgoCD on merge).
- **Promote scout prod past #1508** (merge #1617, or land the #1630 Renovate cutover) so the
  CD-report churn stops and alert 6738 clears permanently. Until then the alert keeps firing;
  do not re-invite the prod bot to Diamond Dudes (beta serves that guild by design).
- Bump `brace-expansion`/`postcss`/`react-router` where the Trivy scan flagged them.
- Pick a remediation for CI-vs-etcd disk contention on torvalds; verify 6738 self-resolves
  after Sunday 18:00 UTC.

### Caveats

- Two earlier hypotheses in this log were corrected by the deeper dig (kept above for the
  audit trail): the 10004 was NOT transient (the prod bot truly left the guild), and the
  missed 2026-07-19 weekly run was NOT deploy timing (the dispatcher skipped it because the
  bot was already not a member).
- The prod bot's absence from Diamond Dudes is intentional (operator confirmed: beta serves
  that guild). Any future "re-invite the prod bot" suggestion is wrong; the fix is keeping
  prod's code current so it doesn't seed reports there.
