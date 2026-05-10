import { withSpan } from "#observability/tracing.ts";
import {
  prReviewPostedTotal,
  prReviewFindingsPerPr,
} from "#observability/metrics.ts";
import {
  prReviewCountTotal,
  prReviewLatencySeconds,
  prReviewCostUsd,
  prReviewConsensusDropRate,
  prReviewVerificationDropRate,
  prReviewDedupeDropRate,
} from "#observability/pr-review-metrics.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Per-model spend recorded by the specialist activities (Anthropic SDK usage
 * + Anthropic public pricing). `model` is the canonical model id used in
 * dashboards (e.g. "claude-opus-4-7", "claude-sonnet-4-6").
 */
export type CostPerModel = { readonly model: string; readonly usd: number };

/**
 * Stage-by-stage drop counts so the metrics activity can compute the
 * `pr_review_*_drop_rate` gauges. Each value is "findings dropped at that
 * stage / findings entering that stage". Out-of-bounds values (negative or
 * > 1) are clamped before being observed.
 */
export type StageDrops = {
  readonly consensusInput: number;
  readonly consensusOutput: number;
  readonly verificationOutput: number;
  readonly dedupeOutput: number;
};

export type EmitMetricsInput = {
  readonly owner: string;
  readonly repo: string;
  /** Number of findings actually posted (post all drop activities). */
  readonly postedFindings: number;
  /** Whether the post activity created a new comment vs edited in place. */
  readonly created: boolean;
  /**
   * Terminal workflow status for the lifecycle counter. Defaults to "posted"
   * (the happy path). A failure-path emit uses the `emitFailureMetrics`
   * activity below instead, which forces "failed".
   */
  readonly status?: "posted" | "skipped";
  /**
   * Workflow `startTime` in ms-since-epoch (deterministic, from
   * `workflowInfo().startTime.getTime()`). Used to compute end-to-end
   * latency in the activity.
   */
  readonly startedAtMs: number;
  /** Sum of all specialist + summarizer model costs, split by model. */
  readonly costs: readonly CostPerModel[];
  /** Stage-by-stage drop counts for the drop-rate gauges. */
  readonly stageDrops: StageDrops;
};

export type EmitFailureMetricsInput = {
  readonly owner: string;
  readonly repo: string;
  readonly startedAtMs: number;
  /** Human-readable failure reason (e.g. activity name, error class). */
  readonly reason: string;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "emitMetrics",
      ...fields,
    }),
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Compute `(input - output) / input`, with the convention that no input
 * means no drop (rate 0). Used for the per-stage drop-rate gauges.
 */
function dropRate(input: number, output: number): number {
  if (input <= 0) return 0;
  return clamp01((input - output) / input);
}

async function emitMetricsImpl(input: EmitMetricsInput): Promise<void> {
  await withSpan(
    "prReview.emitMetrics",
    {
      "pr.owner": input.owner,
      "pr.repo": input.repo,
      "findings.posted": input.postedFindings,
      "metrics.status": input.status ?? "posted",
    },
    () => {
      // Existing Phase 1/2 metrics — posted-comment counter + findings/PR
      // histogram. Unchanged.
      prReviewPostedTotal.inc({
        owner: input.owner,
        repo: input.repo,
        outcome: input.created ? "created" : "updated",
      });
      prReviewFindingsPerPr.observe(input.postedFindings);

      // Phase 8 — workflow lifecycle counter, latency histogram, cost
      // histogram (per model), drop-rate gauges.
      const status = input.status ?? "posted";
      prReviewCountTotal.inc({ repo: input.repo, status });

      const latencySec = Math.max(0, (Date.now() - input.startedAtMs) / 1000);
      prReviewLatencySeconds.observe(latencySec);

      for (const cost of input.costs) {
        if (!Number.isFinite(cost.usd) || cost.usd < 0) continue;
        prReviewCostUsd.observe({ model: cost.model }, cost.usd);
      }

      const consensusDrop = dropRate(
        input.stageDrops.consensusInput,
        input.stageDrops.consensusOutput,
      );
      const verificationDrop = dropRate(
        input.stageDrops.consensusOutput,
        input.stageDrops.verificationOutput,
      );
      const dedupeDrop = dropRate(
        input.stageDrops.verificationOutput,
        input.stageDrops.dedupeOutput,
      );
      prReviewConsensusDropRate.set(consensusDrop);
      prReviewVerificationDropRate.set(verificationDrop);
      prReviewDedupeDropRate.set(dedupeDrop);

      jsonLog("info", "emitMetrics recorded pipeline metrics", {
        postedFindings: input.postedFindings,
        created: input.created,
        status,
        latencySec,
        modelCostCount: input.costs.length,
        consensusDrop,
        verificationDrop,
        dedupeDrop,
      });
      return Promise.resolve();
    },
  );
}

async function emitFailureMetricsImpl(
  input: EmitFailureMetricsInput,
): Promise<void> {
  await withSpan(
    "prReview.emitFailureMetrics",
    {
      "pr.owner": input.owner,
      "pr.repo": input.repo,
      "metrics.status": "failed",
      "failure.reason": input.reason,
    },
    () => {
      prReviewCountTotal.inc({ repo: input.repo, status: "failed" });
      const latencySec = Math.max(0, (Date.now() - input.startedAtMs) / 1000);
      prReviewLatencySeconds.observe(latencySec);
      jsonLog("warning", "pipeline run failed", {
        latencySec,
        reason: input.reason,
      });
      return Promise.resolve();
    },
  );
}

export type MetricsActivities = typeof metricsActivities;

export const metricsActivities = {
  async prReviewEmitMetrics(input: EmitMetricsInput): Promise<void> {
    return emitMetricsImpl(input);
  },
  async prReviewEmitFailureMetrics(
    input: EmitFailureMetricsInput,
  ): Promise<void> {
    return emitFailureMetricsImpl(input);
  },
};
