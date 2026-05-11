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
 * Per-call USD cost reported by the Anthropic API. One observation per
 * specialist pass (5 specialists × 3 passes per PR for the Phase 3
 * pipeline) plus one per Haiku summary call. Sum across labels via
 * `sum(rate(pr_review_cost_usd_sum[...])) by (pr)` for per-PR rollup.
 *
 * `specialist` labels: `correctness`, `security`, `perf`, `convention`,
 * `deps`, `summary` (Haiku). Buckets tuned for the per-call regime
 * ($0.001..$5) since Phase 3 records each call individually rather than
 * the per-PR aggregate.
 */
export const prReviewCostUsd = new Histogram({
  name: "pr_review_cost_usd",
  help: "Per-call USD cost reported by the Anthropic API, by model and specialist",
  labelNames: ["model", "specialist"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
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

// ---------------------------------------------------------------------------
// Phase 9 — dismissed-comments learning loop
// ---------------------------------------------------------------------------

/**
 * Per-finding dedupe drops. Distinct from `pr_review_dedupe_drop_rate`
 * (per-run gauge): this is a long-running counter for trend / total-drops
 * dashboards. `reason` is always `dismissed-similar` today; reserved for
 * future heuristic-specific drop reasons.
 */
export const prReviewDedupeDropTotal = new Counter({
  name: "pr_review_dedupe_drop_total",
  help: "pr-review findings dropped by dedupe-against-dismissed-history, by repo, kind, reason",
  labelNames: ["repo", "kind", "reason"] as const,
  registers: [register],
});

/**
 * Redis connection / command failures from the dedupe activity. When this
 * fires the activity fail-closes (returns all findings unmodified) so the
 * bot keeps posting; alert if sustained.
 */
export const prReviewDedupeRedisErrorTotal = new Counter({
  name: "pr_review_dedupe_redis_error_total",
  help: "pr-review dedupe activity errors talking to Redis, by stage (connect | query | parse)",
  labelNames: ["stage"] as const,
  registers: [register],
});

/**
 * Embedding provider fallback / unavailability counters. `provider` is
 * `voyage` or `local`. `pr_review_embedding_fallback_total` fires when the
 * primary (Voyage) is unavailable and the local fallback succeeds.
 * `pr_review_embedding_unavailable_total` fires when BOTH providers fail —
 * the dedupe activity then fail-closes for that finding.
 */
export const prReviewEmbeddingFallbackTotal = new Counter({
  name: "pr_review_embedding_fallback_total",
  help: "pr-review embedding calls that fell back from Voyage to the local provider, by trigger reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const prReviewEmbeddingUnavailableTotal = new Counter({
  name: "pr_review_embedding_unavailable_total",
  help: "pr-review embedding calls where both Voyage and the local fallback failed",
  registers: [register],
});

/**
 * Reaction-listener workflow activity outcomes. Long-running 15-minute
 * polling loop; each poll fires `started`, then either `ingested` with a
 * count or `errored`. The `kind` label distinguishes thumbs-down vs.
 * resolved-without-followup heuristic.
 */
export const prReviewReactionIngestTotal = new Counter({
  name: "pr_review_reaction_ingest_total",
  help: "pr-review reaction-listener dismissals ingested into the Redis KV, by kind (thumbs-down | resolved-without-followup) and outcome (ingested | skipped-duplicate | errored)",
  labelNames: ["kind", "outcome"] as const,
  registers: [register],
});

export const prReviewReactionPollErrorTotal = new Counter({
  name: "pr_review_reaction_poll_error_total",
  help: "pr-review reaction-listener poll cycles that errored, by stage (github | redis | embedding)",
  labelNames: ["stage"] as const,
  registers: [register],
});
