---
id: log-2026-07-02-gut-alert-remediation
type: log
status: complete
board: false
---

# Gut the alert-remediation workflow

## Status: Complete

## Context

The Temporal `alert-remediation` workflow (`alert-remediation-daily`, an 08:00 PT
sweep that pulled PagerDuty + Bugsink alerts, fanned out one Claude/Codex agent per
alert, and was supposed to open **draft** PRs for straightforward repo-only fixes) was
removed entirely. In ~1 month of operation it produced no value.

### Evidence gathered before removal

- **0 PRs ever opened** — confirmed via `gh` (no `alert-remediation/*` branches, no bot PRs).
  Every "alert-remediation" PR in the repo is hand-authored infra work (#997 created it,
  #1279 throttled it, #1336 hardened the prompt).
- Decision metrics (`alert_remediation_decisions_total`, ~45d): **~564 `failed`, ~2
  `report-only`, 0 `pr-created`, ~0 `not-straightforward`**.
- Subprocess exits: ~502 SIGTERM (hard-killed at the 30-min wall) in the hourly era;
  **0 SIGTERM in the last 10 days** — the hang was fixed by the daily throttle, but the
  daily era still produced 35 `failed` / 2 `report-only` / 0 PRs.
- Root cause is the **premise**, not a bug: most PagerDuty/Bugsink alerts (absence signals,
  infra flaps, capacity) aren't fixable by a repo-only PR. The one readable decision label
  was the agent correctly declining: _"Do not mutate or open a PR. The fired alert
  (`absent_over_time(scout_data_dragon_runs[36h])`) is an absence signal …"_.

## What was removed

**Deleted files** (`packages/temporal`): `src/workflows/alert-remediation.ts`,
`src/activities/alert-remediation{,-collect,-command,-email,-find-pr,-runtime}.ts`,
`src/shared/alert-remediation.ts`, `src/alert-remediation.e2e.test.ts`,
`scripts/{run-alert-remediation-local,trigger-alert-remediation}.ts`, and all their
`.test.ts` siblings (15 files total).

**Edited (reference removal):**

- `src/workflows/index.ts`, `src/activities/index.ts` — dropped imports + registrations.
- `src/schedules/register-schedules.ts` — removed the `SCHEDULES` entry and **added
  `"alert-remediation-daily"` to `DELETED_SCHEDULE_IDS`** so the reconciler deletes the
  live schedule on worker startup (rather than orphaning it — see the orphan-detection
  note in `packages/temporal/CLAUDE.md`).
- `src/observability/metrics.ts` — removed the three `alert_remediation_*` metrics.
- `src/schedules/register-schedules.test.ts`, `src/activities/agent-task.test.ts`,
  `src/shared/agent-subprocess.ts` — removed stale references/comments to deleted symbols.
- `package.json` (dropped `test:e2e` — it only ran the deleted e2e test), root `knip.json`.

**Monitoring (`packages/homelab`):**

- `.../monitoring/rules/temporal.ts` — deleted `AlertRemediationDecisionsAllFailing` and
  `AlertRemediationSweepTimingOut` PrometheusRules.
- `grafana/temporal-dashboard.ts` — deleted the 5 alert-remediation-only panels and removed
  the `alert_remediation_*` series from the two shared agent-subprocess panels (homelab-audit
  series preserved; homelab-audit uses its own `homelab_audit_*` metrics).

**Docs:** updated `todos/pagerduty-migration.md` (retired integration-point row 3),
`todos/agent-task-workflow-broken.md` (2 "Done when" criteria that referenced the removed
row/metrics), and `architecture/2026-06-06_temporal-worker-and-scheduler.md`.

**Kept intentionally:** `src/shared/agent-subprocess.ts` (shared with `agent-task` +
`pr-babysit`); historical archive plans/logs describing the now-removed workflow.

## Verification

- `bun run typecheck` (temporal) — clean (after building the gitignored `@shepherdjerred/llm-models`
  dist, a fresh-worktree setup gap unrelated to this change).
- `bun run test` (temporal) — **642 pass, 0 fail**, including the workflow-bundle webpack smoke
  test. (`src/integration.test.ts` needs a live Temporal dev server and is excluded by the
  `test` script; it's not part of this suite.)
- `bunx eslint .` (temporal) — clean.
- `bun run typecheck` (homelab cdk8s + helm-types) — clean.
- Grep sweep: no live `alertRemediation` / `alert_remediation` references remain in
  `packages/temporal/src` or `packages/homelab/src` (only the intentional `DELETED_SCHEDULE_IDS`
  entries).

## Post-deploy (operator)

After the worker restarts on this revision, confirm in the Temporal UI
(`https://temporal-ui.tailnet-1a49.ts.net`) that `alert-remediation-daily` is gone and that
`temporal_schedule_orphans` stays `0`.

## Session Log — 2026-07-02

### Done

- Removed the entire alert-remediation workflow (15 files deleted + ~10 files edited across
  `packages/temporal`, `packages/homelab`, root `knip.json`, and 3 docs).
- Added `alert-remediation-daily` to `DELETED_SCHEDULE_IDS` so the live schedule is deleted.
- Verified: temporal typecheck/test (642 pass, 0 fail)/eslint clean; homelab typecheck clean.

### Remaining

- Open the PR and merge; after deploy, do the operator check above (schedule gone, orphans 0).

### Caveats

- The 3 `integration` test failures seen under a bare `bun test` are the pre-existing
  live-Temporal-server integration suite (`src/integration.test.ts`), excluded from the
  package `test` script — not caused by this change.
- Fresh worktrees need `@shepherdjerred/llm-models` built (`cd packages/llm-models && bun run build`
  then reinstall) before `packages/temporal` typechecks — `scripts/setup.ts` doesn't build it.
