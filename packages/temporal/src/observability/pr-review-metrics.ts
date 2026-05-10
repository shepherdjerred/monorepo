/**
 * Phase 8 metric series for the SOTA pr-review bot
 * (`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`).
 *
 * Coexists with the Phase 1/2 metrics defined in `./metrics.ts`:
 *   - `pr_review_posted_total{owner, repo, outcome}` (Phase 2 — comment-was-posted)
 *   - `pr_review_comments_per_pr` (Phase 2 — findings/PR histogram)
 *
 * This file adds the workflow-lifecycle, latency, cost, FPR, and drop-rate
 * series. Defined in a sibling file rather than editing `metrics.ts`
 * directly to avoid merge conflicts with the in-flight Phase 2 PR.
 *
 * Namespace decisions (per team-lead 2026-05-10, "Path A"):
 *   - `pr_review_posted_total` — comment-was-actually-posted (Phase 2 counter)
 *   - `pr_review_count_total{repo, status=posted|skipped|failed}` — workflow
 *     lifecycle counter, fires for every invocation (this file)
 */
import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "./metrics.ts";

/**
 * End-to-end wall time: webhook receipt → grouped review comment posted.
 * Buckets cover the SLO band (target p95 ≤ 8 min = 480 s).
 */
export const prReviewLatencySeconds = new Histogram({
  name: "pr_review_latency_seconds",
  help: "End-to-end wall time from webhook receipt to grouped review comment post",
  buckets: [30, 60, 90, 120, 180, 240, 300, 480, 600, 900, 1500],
  registers: [register],
});

/**
 * Estimated USD cost per PR run, labeled by model so we can attribute spend
 * (Opus specialists vs Sonnet specialists vs Haiku summary).
 */
export const prReviewCostUsd = new Histogram({
  name: "pr_review_cost_usd",
  help: "Estimated USD cost per PR review run (per-model leg; sum across labels for total)",
  labelNames: ["model"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 7.5, 10],
  registers: [register],
});

/**
 * Estimated false-positive rate over the trailing 24h window.
 * Populated by the reaction-listener workflow (Phase 9). Defaults to 0.
 */
export const prReviewFprEstimated = new Gauge({
  name: "pr_review_fpr_estimated",
  help: "Estimated false-positive rate (thumbs-down / posted) over trailing 24h",
  registers: [register],
});

/**
 * Per-run drop-rate gauges. The dashboard surfaces the *most recent* drop
 * rate at each stage; 24h trends come from sampling these as the cron
 * window advances.
 */
export const prReviewConsensusDropRate = new Gauge({
  name: "pr_review_consensus_drop_rate",
  help: "Fraction of specialist findings dropped by consensus voting on the most recent PR run",
  registers: [register],
});

export const prReviewVerificationDropRate = new Gauge({
  name: "pr_review_verification_drop_rate",
  help: "Fraction of post-consensus findings dropped by empirical verification on the most recent PR run",
  registers: [register],
});

export const prReviewDedupeDropRate = new Gauge({
  name: "pr_review_dedupe_drop_rate",
  help: "Fraction of post-verification findings dropped by dedupe-against-dismissed-history on the most recent PR run",
  registers: [register],
});

/**
 * Workflow lifecycle counter — fires for every pipeline invocation.
 * Distinct from `pr_review_posted_total` (Phase 2), which only fires
 * when a comment is actually posted.
 */
export const prReviewCountTotal = new Counter({
  name: "pr_review_count_total",
  help: "pr-review pipeline workflow runs by terminal status (posted | skipped | failed)",
  labelNames: ["repo", "status"] as const,
  registers: [register],
});
