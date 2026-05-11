# PR Review Bot — Phase 10 Part 2: Continuous-Eval Workflow + Cron + Alerts

## Status

In Progress

## Context

Phase 10 Part 1 (#743, merged) landed the scaffolding: `eval-fixture.ts`
Zod schema + grader, hand-rolled Bun.SQL migrator, Postgres `pr_review_eval`
database + user, three migration files. Three real-bug fixtures fully
authored in the sibling `monorepo-pr-review-fixtures` repo. Four total
authored after this session (good-morning-headroom landed pre-merge).

Part 2 wires the runtime: the nightly Temporal scheduled workflow that
loads the fixture corpus, replays the bot against each fixture
read-only, grades, persists to Postgres, computes the trailing-7d
regression delta, and fires a PagerDuty alert when precision drops > 5pp.

Same dissociated clone, fresh branch off main.

## Scope — what this PR ships

### 1. Eval Prometheus metrics (`packages/temporal/src/observability/pr-review-eval-metrics.ts`)

Five new series, sibling to `pr-review-metrics.ts`:

| Series                                | Type      | Labels                           | Purpose                                                      |
| ------------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------ |
| `pr_review_eval_precision`            | Gauge     | `category`                       | Precision of the last nightly run (per category + total)     |
| `pr_review_eval_recall`               | Gauge     | `category`                       | Recall of the last nightly run (per category + total)        |
| `pr_review_eval_cost_usd_per_fixture` | Histogram | `category`                       | Cost per fixture replay (matches `pr_review_cost_usd` shape) |
| `pr_review_eval_latency_seconds`      | Histogram | `category`                       | Per-fixture replay latency                                   |
| `pr_review_eval_runs_total`           | Counter   | `category`, `outcome=ok\|failed` | Nightly run counter                                          |

### 2. Activities (`packages/temporal/src/activities/pr-review-eval/`)

Five activities:

- `load.ts` — `loadFixtureCorpus({pin})`: shallow-clone
  `shepherdjerred/monorepo-pr-review-fixtures` at the pinned merge SHA
  into a scratch dir, parse every `fixtures/<id>/fixture.json` against
  `FixtureSchema`, return `Fixture[]`.
- `replay.ts` — `replayBotAgainstFixture({fixture})`: simulate the
  bot run read-only against `fixture.diff`. Returns
  `{postedFindings: Finding[], costUsd, latencySec}`. Phase 10 Part 2
  uses a stub that calls a single specialist (correctness) directly,
  not the full pipeline — Part 3 wires the real workflow.
- `grade.ts` — `gradeRun({fixture, postedFindings})`: calls
  `grade(fixture, postedFindings)` from `eval-fixture.ts`. Returns
  `GradeResult`.
- `persist.ts` — `persistEvalRun({result, costUsd, latencySec})`:
  `INSERT INTO eval_runs` + `INSERT INTO eval_findings`. Uses the
  pr_review_eval_credentials secret (1Password Connect).
- `regression.ts` — `computeRegressionAndMaybeAlert()`: queries
  trailing-7d mean precision from `eval_runs`, compares to current
  run, fires `pr_review_eval_regression_active` gauge to 1 if delta
  > 0.05. Alert rule then PD-pages.

### 3. Parent workflow (`packages/temporal/src/workflows/pr-review-eval/index.ts`)

```
prReviewEvalWorkflow(input: {pin: string})
  ├─ const corpus = await load.loadFixtureCorpus({pin});
  ├─ const replays = parallel(corpus.map(f => replay.replay({fixture: f})));
  ├─ const grades  = replays.map((r, i) => grade.grade({fixture: corpus[i], r}));
  ├─ await persist.persist(grades);
  ├─ await regression.compute();
  └─ await metrics.emit(grades);
```

Concurrency capped at 4 to avoid runaway Anthropic spend.

### 4. Schedule (`packages/temporal/src/schedules/register-schedules.ts`)

```ts
{
  id: "pr-review-eval-nightly",
  workflowType: "prReviewEvalWorkflow",
  args: [{ pin: EVAL_FIXTURES_PIN }],
  cronExpression: "0 3 * * *",  // 03:00 PT daily — staggered before
                                 // zfs-maintenance (03:00 Sun) and after
                                 // bugsink-housekeeping (03:00)
  taskQueue: TASK_QUEUES.PR_REVIEW,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "2 hours",
  memo: "Nightly pr-review-bot continuous-eval — replay against fixture corpus, persist precision/recall to pr_review_eval, fire PD alert on > 5pp drop",
}
```

`EVAL_FIXTURES_PIN` is a constant in `src/shared/pr-review/eval-fixture.ts`
pinned to a specific merge SHA in the fixtures repo. Bump via PR when
the corpus is updated.

### 5. PagerDuty alert rule (`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/pr-review-bot.ts`)

Extend the existing `pr-review-bot-quality` group with:

```ts
{
  alert: "PrReviewBotEvalPrecisionRegression",
  annotations: {
    description: "pr-review-bot nightly eval precision is {{ $value | humanizePercentage }} below the trailing-7-day mean (threshold 5pp). A prompt/model regression is shipping unnoticed; investigate via Postgres eval_runs.",
    summary: "pr-review-bot eval precision regression > 5pp",
  },
  expr: "max without(...) (pr_review_eval_regression_active) > 0.5",
  for: "5m",
  labels: { severity: "critical" },  // PD page
}
```

### 6. Synthetic injector (`packages/temporal/scripts/inject-eval-regression.ts`)

Local CLI that overwrites one fixture's `expectedFindings` with synthetic
noise so the next nightly cron will see a precision drop > 5pp. Used to
verify the alert wiring without waiting for a real regression.

```fish
bun run packages/temporal/scripts/inject-eval-regression.ts --fixture-id scout-data-dragon-env-leak --dry-run
```

Writes a temporary patch to a separate `fixtures-injected/` directory
in the fixtures repo (not the canonical corpus), then bumps `EVAL_FIXTURES_PIN`
temporarily for the next run only.

## Scope — explicitly NOT in this PR

- **Real specialist fan-out in `replay.ts`**: Part 2 uses a single-specialist
  stub (correctness only). Part 3 wires the full pipeline once Phase 3
  (specialists × consensus) lands. Phase 9 (dedupe) also needs to be live
  before grading is fully apples-to-apples.
- **OnePasswordItem CR for pr_review_eval credentials**: the
  postgres-operator generates a Kubernetes secret automatically at
  `pr_review_eval.temporal-postgresql.credentials.postgresql.acid.zalan.do`;
  Part 2 reads it directly via env var injection. A standalone OnePasswordItem
  would only be needed if we wanted to mirror to 1Password Connect for
  audit visibility — out of scope.
- **Worker boot migrator call**: Part 2 expects the operator (or me, via
  the CLI script) to have run the migrations once at deploy time. A
  worker-boot migration call lands when the temporal-worker chart is
  updated with the eval workflow.

## Tests

- `packages/temporal/src/activities/pr-review-eval/*.test.ts` for each
  activity. Mock `Bun.SQL` for `persist.ts` and `regression.ts`.
- `packages/temporal/src/workflows/pr-review-eval/index.test.ts` —
  Temporal test-time-skipping runner, asserts the activity ordering
  and that the regression activity sees the grader output.

## Verification

- `bun run typecheck` clean.
- `bun run test` clean (existing + new).
- `bun run packages/temporal/scripts/inject-eval-regression.ts --dry-run`
  produces a fixture diff that grade() scores below the 7d-mean threshold.
- Real run after deploy: kubectl exec into temporal-worker, trigger
  the workflow manually via `temporal workflow start --type prReviewEvalWorkflow`,
  verify Postgres rows + Prometheus series populate.
