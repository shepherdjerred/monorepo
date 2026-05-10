# PR Review Bot — Phase 10: Continuous-Eval Harness

## Status

In Progress

## Context

Phase 10 of the SOTA PR review bot per
`packages/docs/plans/2026-05-10_sota-pr-review-bot.md` (Task #10). Builds
the held-out labeled fixture corpus and the nightly Temporal cron that
grades the bot against it. Without this, model/prompt drift goes undetected.

Phase 8 (#741) landed the metric definitions, dashboard, and alert rules.
Phase 3 (#737) landed the cluster-key utility. Phase 2 (#738) landed the
Path-A metric namespace. We now have everything needed to wire the eval
loop.

## Architecture

```
nightly Temporal cron @ 03:00 PT
  ↓
prReviewEvalWorkflow
  │
  ├─ activity: loadFixtureCorpus
  │     • git pull shepherdjerred/monorepo-pr-review-fixtures @ evalFixturesPin
  │     • parse fixtures/*/fixture.json → Fixture[]
  │
  ├─ activity: replayBotAgainstFixtures  [parallel, capped at 4 concurrent]
  │     • for each fixture: simulate the PR head from snapshotRef
  │     • run prReviewPipeline (read-only mode — no comment posted)
  │     • collect: postedFindings, latencySec, costUsd
  │
  ├─ activity: gradeRuns
  │     • for each (fixture, postedFindings): call grade() from eval-fixture.ts
  │     • produce GradeResult[] with tp/fp/fn/precision/recall + details
  │
  ├─ activity: persistEvalRuns
  │     • INSERT INTO eval_runs (one row per fixture-run)
  │     • INSERT INTO eval_findings (per-finding TP/FP/FN classification)
  │
  ├─ activity: computePrecisionRegression
  │     • aggregate mean precision over trailing-7-day window from eval_runs
  │     • if current run precision < trailing_mean - 0.05: emit alert metric
  │
  └─ activity: emitEvalMetrics
        • prometheus: pr_review_eval_precision, pr_review_eval_recall,
          pr_review_eval_cost_usd_per_fixture, pr_review_eval_latency_seconds
```

## Scope — what this PR ships

### 1. Postgres `pr_review_eval` database

- New database + dedicated `pr_review_eval` user in existing
  `temporal-postgresql` cluster (least-privilege).
- File: `packages/homelab/src/cdk8s/src/resources/postgres/temporal-db.ts` —
  add the database + user.
- Migration files: `packages/temporal/src/db/migrations/pr-review-eval/`
  - `000_init.sql` — `_migrations` ledger + Finding enums
  - `001_eval_runs.sql` — per-fixture-run scoring
  - `002_eval_findings.sql` — per-finding TP/FP/FN detail
- Migrator: `packages/temporal/src/db/migrate.ts` (hand-rolled, no Prisma).

### 2. Fixture loader + grader

- `packages/temporal/src/shared/pr-review/eval-fixture.ts` — Zod schema for
  `Fixture`, `clusterKey`/`clusterFindings` imports, `grade()` function.
- Companion test: `eval-fixture.test.ts`.

### 3. Fixture corpus materialization

- 50 fixtures in `shepherdjerred/monorepo-pr-review-fixtures`, 10 per
  category. **PR-shape contract for `real-bug` fixtures TBD with team-lead**:
  - **Option A**: inverted-fix diff — PR head = parent of fix commit;
    PR base = fix commit. Bot reviews "this PR removes X" and is expected
    to flag the bug being reintroduced.
  - **Option B**: synthesized full-file diff — PR head adds the entire
    buggy file fresh. Bot reviews "this new code"; expected finding:
    "this is missing X".
- Going with **Option A** (cleaner mental model, lower fixture-author
  effort, closer to a real PR shape) unless team-lead overrides.

### 4. Nightly cron workflow

- `packages/temporal/src/workflows/pr-review-eval/index.ts` — orchestrates
  load → replay → grade → persist → alert.
- Registered in `packages/temporal/src/schedules/register-schedules.ts`
  at `03:00 PT` daily (after `zfs-maintenance` at 03:00, before
  `velero-orphan-audit` at 03:30 — staggering already in place).

### 5. Synthetic regression injector

- `packages/temporal/scripts/inject-eval-regression.ts` — overwrites one
  fixture's `expectedFindings` with synthetic noise so the next nightly
  cron run will surface a precision drop > 5pp.

### 6. PagerDuty alert

- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/pr-review-bot.ts`
  — extend existing groups with `PrReviewBotEvalPrecisionDrop` rule:
  `pr_review_eval_precision < trailing_7d_mean - 0.05`, severity=critical.

## Verification

- `bun run typecheck` clean in `packages/temporal` and `packages/homelab`.
- `bun test packages/temporal/src/shared/pr-review/eval-fixture.test.ts` —
  all pass.
- Manual: trigger `inject-eval-regression.ts` against a fixture, manually
  invoke the workflow, confirm PagerDuty alert fires.

## Sequencing within this PR

Order of land:

1. Migration files + migrator + Postgres user (small, type-safe, reusable)
2. eval-fixture.ts schema + grader + tests
3. Stub workflow + activities (calling everything, returning fixtures
   the bot would emit — placeholder until fixture corpus exists)
4. Fixture materialization (after team-lead confirms PR-shape contract)
5. Wire workflow to schedule + register PD alert
6. Synthetic regression script
