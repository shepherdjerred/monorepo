# Remove the PR Review Eval Bot

## Status

Complete

## Context

The Temporal package (`packages/temporal`) hosted a **PR review eval bot** — a
continuous-evaluation and A/B-experimentation harness bolted onto the SOTA PR review bot,
with two schedule-driven workflows:

- **`prReviewEvalWorkflow`** (`pr-review-eval-nightly`, cron `0 4 * * *`) — cloned an external
  fixture corpus, replayed the review pipeline against it, graded precision/recall, persisted
  to a dedicated `pr_review_eval` Postgres DB, and raised a regression alert.
- **`prReviewWeeklySignificanceWorkflow`** (`pr-review-ab-weekly-report`, cron `0 9 * * 1`) —
  Bayesian A/B significance report posted to Discord.

Both schedules were already auto-paused in production (the env vars
`PR_REVIEW_FIXTURES_REPO_URL` / `PR_REVIEW_EVAL_DATABASE_URL` were never wired into the worker
pod, and the whole PR bot sits behind `PR_BOT_ENABLED=false`). The harness was dead weight:
unused code, an idle Postgres database, dormant PagerDuty alerts, and stale docs. This change
removed it entirely.

**Scope guardrail:** only the _eval_ bot was removed. The live `prReviewPipeline` /
`prSummaryPipeline` review bots stay. The import boundary was verified clean and
one-directional — no file under `src/workflows/pr-review/**` or `src/activities/pr-review/**`
imports eval code. The only shared file the eval code touched, `src/shared/pr-review/cluster-key.ts`,
is also used by the live pipeline and was kept.

## Key mechanic: schedules tombstoned, not just deleted

`registerSchedules()` is upsert-only over the `SCHEDULES` array — it never prunes a schedule
merely removed from source. On startup it deletes exactly the ids in `DELETED_SCHEDULE_IDS`,
and `detectOrphanSchedules()` raises the `temporal_schedule_orphans` gauge (→ PagerDuty) for
any live schedule that is neither declared, tombstoned, nor a dynamic agent-task schedule.
So both `"pr-review-eval-nightly"` and `"pr-review-ab-weekly-report"` were added to
`DELETED_SCHEDULE_IDS` in the same change that removed the workflow types from the bundle.

## Changes

### 1. Deleted eval source (`packages/temporal/`)

`src/workflows/pr-review-eval/`, `src/activities/pr-review-eval/` (15 files),
`src/shared/pr-review/variant.ts`+test, `src/shared/pr-review/eval-fixture.ts`+test,
`src/observability/pr-review-eval-metrics.ts`, `src/observability/pr-review-experiment-metrics.ts`,
`src/db/` (migrator + 4 SQL migrations), `scripts/run-pr-review-eval-migrations.ts`,
`scripts/inject-eval-regression.ts`. **Kept** `src/shared/pr-review/{cluster-key,context,finding}.ts`.

### 2. Edited temporal registries + schedules

- `src/workflows/index.ts` — removed the two eval wrappers + imports/types.
- `src/activities/index.ts` — removed `prReviewEvalActivities` import + spread.
- `src/schedules/register-schedules.ts` — removed the two `SCHEDULES` entries, eval constants,
  `EVAL_FIXTURES_PIN` import, `prReviewEvalFixturesConfigured` / `prReviewEvalDatabaseConfigured`
  / `scheduleRequiresConfigPause` / `reconcileSchedulePauseState` + its call site; **added** the
  two tombstones to `DELETED_SCHEDULE_IDS`; simplified `handle` to `const` (dead reassignment
  dropped). Pause preservation now relies solely on the `...prev` spread in `handle.update`.
- `src/schedules/register-schedules.test.ts` — removed the two eval `describe` blocks, the
  `scheduleRequiresConfigPause` import, and the two eval entries from `WORKFLOWS_WITHOUT_LONG_SLEEPS`.
- `scripts/check-suppressions.ts` — removed the stale `pr-review-eval/load.ts` allow-list entry.

### 3. Homelab IaC teardown (`packages/homelab/`)

- `src/cdk8s/src/resources/postgres/temporal-db.ts` — removed `pr_review_eval` user, database,
  and pg_hba entry.
- `src/cdk8s/src/resources/monitoring/monitoring/rules/pr-review-bot.ts` — removed the
  `pr-review-bot-eval` rule group and the eval-metric lines from the header comment. Kept the
  `pr-review-bot-quality` and `pr-review-bot-throughput` groups (live bot).
- `src/cdk8s/src/resources/temporal/worker.ts` — removed the dead `PR_REVIEW_FIXTURES_REPO_URL`
  comment block.

### 4. Docs

- Edited live: `architecture/2026-06-06_temporal-worker-and-scheduler.md` (eval bullet,
  pause-reconcile step, Notable-IDs line, DB paragraph), `packages/temporal/AGENTS.md`
  (pause prose), `guides/2026-05-22_temporal-post-deploy-quality-checklist.md` (nightly-eval
  step + scope line).
- Tombstoned 5 archived plan docs (`archive/completed/2026-05-10_pr-review-bot-phase-{8,10,10-part-2,11}*`
  and `2026-05-10_sota-pr-review-bot.md`).

## Manual post-merge steps (out-of-band — operator)

1. Drop the Postgres DB/role (cluster has `Delete=false`, so IaC removal won't drop it):
   `DROP DATABASE pr_review_eval;` / `DROP ROLE pr_review_eval;`. Also delete the orphaned
   operator secret `pr_review_eval.temporal-postgresql.credentials.postgresql.acid.zalan.do`.
2. Confirm no orphan `PR_REVIEW_EVAL_DATABASE_URL` / `PR_REVIEW_FIXTURES_REPO_URL` field remains
   on the `temporal-worker` 1Password item (nothing in-repo references it).
3. Post-deploy: `temporal schedule list` should no longer show the two ids; keep
   `temporal_schedule_orphans` at `0`.

## Verification

- `packages/temporal`: `bun run typecheck`, `bun test` (incl. bundle smoke + register-schedules),
  `bunx eslint .`.
- `packages/homelab`: `bun run typecheck`, `bun run test`, `bun run scripts/check-1password-items.ts`.
- Repo root: `bun scripts/check-todos.ts`, `bun run scripts/check-suppressions.ts`.
- Residue grep for `pr[_-]review[_-]eval|prReviewEval|WeeklySignificance|EVAL_FIXTURES_PIN|pr_review_eval|ACTIVE_EXPERIMENTS`
  returns only intentional tombstone/historical hits.

## Session Log — 2026-07-03

### Done

- Deleted 29 eval source files under `packages/temporal` (workflows, activities, eval-only
  shared/observability modules, the `src/db/` migrator + SQL, two scripts).
- Edited the two bundle registries, `register-schedules.ts` (+ tombstones), its test, and
  `scripts/check-suppressions.ts`.
- Tore down homelab IaC: Postgres DB/role/pg_hba, the `pr-review-bot-eval` alert group, the
  dead worker.ts comment.
- Updated 3 live docs and tombstoned 5 archived plan docs; mirrored this plan.
- Verification results recorded inline in the final chat message.

### Remaining

- Manual operator steps above (Postgres DROP, 1Password check) after merge/deploy.
- Open the PR.

### Caveats

- `reconcileSchedulePauseState` is gone; live pause state now survives restarts purely via the
  `...prev` spread in `handle.update` (verified this preserves `state`). No schedule auto-pauses
  or auto-unpauses anymore — correct, since the only consumers were the two eval schedules.
- The dedicated `pr_review_eval` Postgres database is NOT dropped by removing the cdk8s
  provisioning (`Delete=false` + the operator never drops databases); it must be dropped
  manually or it lingers as idle storage.
