# PR Review Bot — Phase 11: A/B Prompt Experimentation Framework

## Status

In Progress

## Context

Phase 11 in the SOTA plan (`/Users/jerred/.claude/plans/what-is-sota-in-mellow-wren.md`)
calls for an A/B framework that selects prompt variants per PR with sticky
hashing, captures per-PR outcomes alongside the eval Postgres data, runs a
weekly significance report as a Temporal workflow, and posts to Discord —
**manual promotion only**.

This PR ships the framework. Variant plumbing into `correctnessReviewer` /
`runSpecialists` (Phase 3 owned by other teammates) is explicitly out of
scope — the framework is ready to wire up once their PR lands.

## Scope — what this PR ships

| #   | File                                                                             | Purpose                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/temporal/src/db/migrations/pr-review-eval/003_real_pr_experiments.sql` | New `real_pr_experiments` table — per-(PR × experiment) row with sticky-hash assignment, outcome counters, and tristate `accepted` for Phase 9 backfill                                                                              |
| 2   | `packages/temporal/src/shared/pr-review/variant.ts`                              | Zod schemas for `Experiment` / `VariantArm`, `ACTIVE_EXPERIMENTS` registry, pure `assignVariant({experiment, repo, author})` SHA-256 sticky hash, `findActiveExperiment(id)`                                                         |
| 3   | `packages/temporal/src/activities/pr-review-eval/variant.ts`                     | Three activities: `prReviewAssignVariant`, `prReviewRecordExperimentOutcome` (INSERT ... ON CONFLICT upsert), `prReviewRecordAcceptance` (called by Phase 9's reaction listener)                                                     |
| 4   | `packages/temporal/src/activities/pr-review-eval/significance.ts`                | Bayesian beta-binomial posterior + Monte Carlo `P(arm > rest)`; pure `summarize(experiment, rows, window)` for unit tests; activity wrapper queries Postgres                                                                         |
| 5   | `packages/temporal/src/activities/pr-review-eval/discord-post.ts`                | `fetch()` POST to `DISCORD_PR_REVIEW_WEBHOOK` with a color-coded embed (green=winner-ready, amber=inconclusive, grey=insufficient-data). Soft-fail: webhook errors are logged but don't tank the workflow                            |
| 6   | `packages/temporal/src/activities/pr-review-eval/experiment-metrics.ts`          | Workflow-callable activity that emits Prom gauges from a `SignificanceReport` + exposes `ACTIVE_EXPERIMENTS` ids to the workflow (workflows can't import `variant.ts` directly — `node:crypto` is non-deterministic)                 |
| 7   | `packages/temporal/src/observability/pr-review-experiment-metrics.ts`            | Four Prom series: `pr_review_experiment_posterior_mean` / `_labeled_count` / `_win_probability` (gauges, labeled by `experiment_id` + `variant`) and `_reports_total` counter                                                        |
| 8   | `packages/temporal/src/workflows/pr-review-eval/weekly-significance.ts`          | `prReviewWeeklySignificanceWorkflow` — Mon 09:00 PT cron, iterates active experiments, calls significance → metrics → discord-post per experiment                                                                                    |
| 9   | `packages/temporal/src/schedules/register-schedules.ts`                          | New `pr-review-ab-weekly-report` schedule entry (Mon 09:00 PT, PR_REVIEW queue, 10-min timeout)                                                                                                                                      |
| 10  | Tests                                                                            | `variant.test.ts` (sticky-hash determinism + distribution + weight respect), `significance.test.ts` (verdict logic + posterior math + zero-arm handling + pairwise symmetry), `discord-post.test.ts` (embed builder color + content) |

## Statistical method — Bayesian beta-binomial (decided)

Plan offered SPRT or Bayesian. **Picked Bayesian** because:

1. Team can interpret "70% probability variant B is better" without statistics training.
2. Bayesian naturally handles peeking — no alpha inflation if we look on Wed and Fri.
3. SPRT requires committing to α and β upfront, which is brittle for a 2-person-week cadence.

Model per arm: `acceptance_rate ~ Beta(1 + accepts, 1 + dismisses)` (uniform prior, conjugate posterior). `P(B > A)` via 100k-sample Monte Carlo. Verdict = `winner-ready` when `min_{u≠v} P(v > u) ≥ winnerThresholdProbability` (default 0.95) AND every arm has ≥ `minLabeledPrsPerArm` (default 30).

Decision lives in `variant.ts` docstring + this plan; configurable per-experiment.

## Scope — explicitly NOT in this PR

| Out-of-scope                                                      | Why                                                                                                                                                                         | Where it lives later                                                                                                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variant plumbing through `correctnessReviewer` / `runSpecialists` | Phase 3's specialist runner signature is in flight (owned by retrieval teammate, Task #2). Wiring variant-keyed system prompts in now would create merge conflicts          | A 1-line change in the prompt-cache wrapper once Phase 3 settles. Tracked: `packages/temporal/src/activities/pr-review/specialists/correctness.ts` `CORRECTNESS_SYSTEM_PROMPT` switches on `variant` |
| Author-acceptance signal collection                               | Phase 9 (feedback teammate's Task #3) owns the reaction-listener workflow that decides "accepted vs dismissed". The schema accepts `accepted IS NULL` so the backfill works | Phase 9's reaction listener calls `prReviewRecordAcceptance`                                                                                                                                         |
| Auto-promotion                                                    | Plan is explicit: manual promotion only                                                                                                                                     | Operator runbook (Phase 14)                                                                                                                                                                          |
| Multi-experiment fan-out at PR time                               | Phase 11 ships ONE example experiment (`correctness-system-prompt-v1`). Concurrent experiments would need a routing layer — premature                                       | A follow-up when we have a second prompt change to test                                                                                                                                              |
| Discord webhook OnePasswordItem CR                                | The 1P item already exists (`DISCORD_PR_REVIEW_WEBHOOK` field is sourced via the temporal-worker pod's existing OnePasswordItem). No new CR needed                          | n/a                                                                                                                                                                                                  |

## Schema additions

```sql
-- 003_real_pr_experiments.sql (summary; full file in the migration)
CREATE TABLE real_pr_experiments (
  id BIGSERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  repo_full TEXT NOT NULL,
  pr_number INT NOT NULL,
  author TEXT NOT NULL,
  bot_run_id TEXT NOT NULL,
  bot_commit_sha TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  posted_findings INT NOT NULL,
  cost_usd DOUBLE PRECISION NOT NULL,
  latency_seconds DOUBLE PRECISION NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN,           -- NULL = not labeled yet
  acceptance_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, repo_full, pr_number)
);
```

Three indexes: `(experiment_id, variant)` for the per-arm count query, `(finished_at DESC)` for window queries, partial `(experiment_id, variant, accepted) WHERE accepted IS NOT NULL` for the significance computation's hot path.

`eval_runs.experiment_id` + `eval_runs.variant` already exist from Phase 10 Part 1 — fixture-side runs reuse the same columns.

## Verification commands

```fish
# Unit tests
bun test packages/temporal/src/shared/pr-review/variant.test.ts
bun test packages/temporal/src/activities/pr-review-eval/significance.test.ts
bun test packages/temporal/src/activities/pr-review-eval/discord-post.test.ts

# Typecheck
cd packages/temporal && bun run typecheck

# Lint
bunx eslint packages/temporal/src/shared/pr-review/variant.ts \
  packages/temporal/src/activities/pr-review-eval/ \
  packages/temporal/src/workflows/pr-review-eval/weekly-significance.ts \
  packages/temporal/src/observability/pr-review-experiment-metrics.ts

# Apply the migration (port-forward needed locally)
PR_REVIEW_EVAL_DATABASE_URL=<dsn> bun run packages/temporal/scripts/run-pr-review-eval-migrations.ts

# Manual trigger after deploy
temporal workflow start --type prReviewWeeklySignificanceWorkflow \
  --task-queue pr-review --input '{}'
```

## Dependencies

- **Phase 10 Part 1 (#743, merged)** — pr_review_eval database, \_migrations table, finding enums
- **Phase 10 Part 2 (PR #769, in review)** — pr-review-eval activities directory, scheduler entries, prReviewEvalActivities index. This PR is stacked on `feature/2026-05-10-pr-review-bot-task-10-part-2` and will rebase to main once #769 lands
- **Phase 9 (in flight, feedback teammate)** — Reaction listener will call `prReviewRecordAcceptance` to backfill `accepted` column. Until that lands, every row stays `accepted=NULL` and the weekly report verdict is `insufficient-data`

## Risk + rollback

- **Migration rollback**: `003_real_pr_experiments.sql` is additive. Rollback = `DROP TABLE real_pr_experiments` + delete the corresponding `_migrations` row. The migrator doesn't auto-rollback; manual `psql` if needed.
- **Schedule rollback**: delete the `pr-review-ab-weekly-report` entry in `register-schedules.ts`, redeploy worker, the schedule's `update`-or-create path will leave the now-orphaned schedule. The leftover orphan can be reaped via `temporal schedule delete --schedule-id pr-review-ab-weekly-report`.
- **Discord post failure**: soft-fail by design. The Postgres row is the canonical record; Discord is a courtesy.
- **Webhook secret exposure**: webhook URL stays in 1Password Connect, injected as env var. Never logged.

## Session Log — 2026-05-10

### Done

- Authored migration `003_real_pr_experiments.sql` (per-PR experiment row with sticky-hash variant, outcome counters, tristate `accepted`).
- Authored `shared/pr-review/variant.ts` with Zod `Experiment` / `VariantArm` schemas, `ACTIVE_EXPERIMENTS` registry, pure SHA-256 sticky-hash `assignVariant()`, and `findActiveExperiment()`.
- Authored three variant activities (`activities/pr-review-eval/variant.ts`): `prReviewAssignVariant`, `prReviewRecordExperimentOutcome` (INSERT ON CONFLICT upsert with `xmax <> 0` conflict detection), `prReviewRecordAcceptance` (called by Phase 9).
- Authored Bayesian significance engine (`activities/pr-review-eval/significance.ts`): Marsaglia & Tsang Gamma sampler, ratio-of-Gammas Beta sampler, 100k-sample Monte Carlo `P(arm > rest)`, verdict logic with pure `summarize()` exported for tests.
- Authored Discord post activity (`activities/pr-review-eval/discord-post.ts`): direct `fetch()` to `DISCORD_PR_REVIEW_WEBHOOK`, color-coded embed (green/amber/grey), soft-fail behavior.
- Authored experiment Prom metrics + workflow-callable metrics activity (`activities/pr-review-eval/experiment-metrics.ts`, `observability/pr-review-experiment-metrics.ts`).
- Authored `prReviewWeeklySignificanceWorkflow` (`workflows/pr-review-eval/weekly-significance.ts`) and registered it in `workflows/index.ts`.
- Added `pr-review-ab-weekly-report` schedule entry (Mon 09:00 PT, PR_REVIEW queue, 10-min timeout).
- Wrote three test files: `variant.test.ts` (16 tests), `significance.test.ts` (6 tests), `discord-post.test.ts` (5 tests).
- Committed (0c1eb743f) and pushed; opened draft PR #770 stacked on PR #769.
- Verified clean: typecheck (`bunx tsc --noEmit`), tests (61 pass / 0 fail), eslint, prettier, markdownlint, all pre-commit hooks (gitleaks, env-var-names, large-files, check-suppressions, migration-guard, homelab-helm-lint, homelab-typecheck, tunnel-dns-coverage, quality-ratchet).

### Remaining

- **Variant plumbing into the specialists runner** — not in scope this PR. Hook is a 1-line change in `correctness.ts` `CORRECTNESS_SYSTEM_PROMPT` once Phase 3's specialist runner stabilizes (owned by retrieval teammate / Task #2).
- **Acceptance backfill wire-up** — Phase 9 (feedback teammate / Task #3) must call `prReviewRecordAcceptance` from the reaction listener. Without that, every row stays `accepted=NULL` and the weekly verdict is `insufficient-data` (correct fail-closed behavior).
- **Migration apply** — the migrator runs against live Postgres needs to be triggered after PR merge: `PR_REVIEW_EVAL_DATABASE_URL=<dsn> bun run packages/temporal/scripts/run-pr-review-eval-migrations.ts` (or wait for the worker-boot migrator hook to land).
- **First real experiment** — `ACTIVE_EXPERIMENTS` ships with one placeholder (`correctness-system-prompt-v1`); a real prompt-variant experiment is a follow-up PR.

### Caveats

- The workflow can't import `variant.ts` directly because `node:crypto` is non-deterministic from Temporal's perspective. Workaround: `experiment-metrics.ts` activity exposes `ACTIVE_EXPERIMENTS.map(e => e.id)` to the workflow. Documented in the workflow comment.
- Bayesian over SPRT was a judgment call captured in `variant.ts` docstring. If a teammate wants SPRT later, the `significance.ts` summarizer is replaceable while keeping the same `SignificanceReport` shape.
- 100k Monte Carlo samples per pairwise comparison gives std err ~0.001 at probability=0.5. Multi-arm experiments scale as O(arms² × 100k); 5-arm experiments are still under 2.5M samples, sub-second.
- The `pr-review-ab-weekly-report` schedule will register on the next worker restart; if a manual trigger is needed before that, run `temporal workflow start --type prReviewWeeklySignificanceWorkflow --task-queue pr-review --input '{}'`.
- The PR stacks on PR #769. Rebase to main after #769 lands; if there's churn in `register-schedules.ts` between now and then, the PR #769 schedule entry stays, and Phase 11's entry needs to land cleanly above it.
