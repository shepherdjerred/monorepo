/**
 * Phase 11 A/B experimentation metrics. Populated by the weekly
 * significance workflow once per run, NOT per-PR. Per-PR cost / latency
 * already lives on `pr_review_*` series from Phase 8 — labeling by
 * `variant` would balloon series cardinality, so we keep variant
 * granularity in Postgres and only surface the weekly aggregates here.
 */
import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.ts";

/**
 * Posterior mean acceptance rate per (experiment, variant). Last
 * weekly report's value.
 */
export const prReviewExperimentPosteriorMean = new Gauge({
  name: "pr_review_experiment_posterior_mean",
  help: "Posterior mean acceptance rate from the most recent weekly A/B report, labeled by experiment id + variant",
  labelNames: ["experiment_id", "variant"] as const,
  registers: [register],
});

/**
 * Labeled-PR count per (experiment, variant). Drives the
 * `insufficient-data` verdict — surfaced so the dashboard makes it
 * obvious when an experiment is still ramping.
 */
export const prReviewExperimentLabeledCount = new Gauge({
  name: "pr_review_experiment_labeled_count",
  help: "Count of labeled PRs (accepted IS NOT NULL) in the last weekly window, by experiment + variant",
  labelNames: ["experiment_id", "variant"] as const,
  registers: [register],
});

/**
 * Probability the variant beats every other arm — the same
 * `min_{u≠v} P(v > u)` quantity the verdict uses. Plotted on the
 * dashboard so the operator can watch the winning probability climb
 * toward the threshold without waiting on a Discord post.
 */
export const prReviewExperimentWinProbability = new Gauge({
  name: "pr_review_experiment_win_probability",
  help: "Min probability that the labeled variant beats every other arm in the experiment",
  labelNames: ["experiment_id", "variant"] as const,
  registers: [register],
});

/**
 * Weekly workflow completion counter. `outcome=ok` when the
 * significance computation + Postgres write + (optional) Discord
 * post all completed. Discord failure alone does NOT count as
 * failed — see discord-post.ts soft-fail rationale.
 */
export const prReviewExperimentReportsTotal = new Counter({
  name: "pr_review_experiment_reports_total",
  help: "Weekly A/B significance workflow runs, by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});
