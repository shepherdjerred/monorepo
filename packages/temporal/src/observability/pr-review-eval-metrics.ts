/**
 * Phase 10 Part 2 metric series for the nightly continuous-eval cron
 * (`packages/docs/plans/2026-05-10_sota-pr-review-bot.md` Phase 10).
 *
 * Sibling to `./pr-review-metrics.ts` (Phase 8 — bot-run metrics).
 * These series are populated by the `prReviewEvalWorkflow` once per
 * nightly run, NOT per-PR. They describe how the bot performed against
 * the held-out fixture corpus.
 */
import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "./metrics.ts";

/**
 * Precision of the last nightly eval run. Gauged per category + `total`
 * (the cluster-key matched count over the union of clusters across all
 * categories), so the dashboard can show category-specific quality
 * dropping without it being hidden by other categories' good numbers.
 */
export const prReviewEvalPrecision = new Gauge({
  name: "pr_review_eval_precision",
  help: "Precision (tp / (tp + fp)) of the last nightly continuous-eval run, by category. `total` covers all categories.",
  labelNames: ["category"] as const,
  registers: [register],
});

/**
 * Recall of the last nightly eval run, same shape as precision.
 */
export const prReviewEvalRecall = new Gauge({
  name: "pr_review_eval_recall",
  help: "Recall (tp / (tp + fn)) of the last nightly continuous-eval run, by category. `total` covers all categories.",
  labelNames: ["category"] as const,
  registers: [register],
});

/**
 * Per-fixture replay cost (USD), labeled by fixture category for
 * dashboard breakdowns.
 */
export const prReviewEvalCostUsdPerFixture = new Histogram({
  name: "pr_review_eval_cost_usd_per_fixture",
  help: "USD cost per fixture replay during nightly continuous-eval, by category",
  labelNames: ["category"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 7.5, 10],
  registers: [register],
});

/**
 * Per-fixture replay latency.
 */
export const prReviewEvalLatencySeconds = new Histogram({
  name: "pr_review_eval_latency_seconds",
  help: "Wall time per fixture replay during nightly continuous-eval, by category",
  labelNames: ["category"] as const,
  buckets: [10, 30, 60, 120, 240, 480, 960],
  registers: [register],
});

/**
 * Nightly cron completion counter. `outcome=ok` when every fixture
 * graded; `failed` when the workflow itself raised (the alert rule
 * separately fires on precision regression — this is a workflow-health
 * counter, not a quality counter).
 */
export const prReviewEvalRunsTotal = new Counter({
  name: "pr_review_eval_runs_total",
  help: "Nightly continuous-eval workflow runs, by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

/**
 * Precision-regression flag for the alertmanager rule.
 *
 * Set to 1 when the most recent nightly run's mean precision is below
 * the trailing-7-day mean by > 5pp; 0 otherwise. The alert rule reads
 * this as `> 0.5`. Computed by `computeRegressionAndMaybeAlert` from
 * `pr_review_eval` Postgres data.
 *
 * Why a gauge and not a derived expression in the alert: trailing-7d
 * over `pr_review_eval_precision_bucket` is non-trivial in PromQL
 * because the gauge gets overwritten each run. Computing the
 * comparison in TypeScript against the SQL source-of-truth keeps the
 * alert's semantics readable.
 */
export const prReviewEvalRegressionActive = new Gauge({
  name: "pr_review_eval_regression_active",
  help: "1 when the most recent nightly precision is > 5pp below the trailing-7-day mean; 0 otherwise. Drives the PrReviewBotEvalPrecisionRegression PagerDuty alert.",
  registers: [register],
});
