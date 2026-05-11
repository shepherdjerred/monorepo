/**
 * Weekly A/B significance workflow.
 *
 * Triggered by the `pr-review-ab-weekly-report` schedule
 * (Mon 09:00 PT). For each active experiment, computes the
 * Bayesian posterior + decision verdict over the last 28 days
 * of labeled PRs, surfaces the result via Prometheus gauges,
 * and posts a Discord embed.
 *
 * Iterates experiments sequentially — A/B compute is cheap and
 * the workflow is rare; parallel execution would add complexity
 * without payback.
 */
import { proxyActivities } from "@temporalio/workflow";
import type { EvalSignificanceActivities } from "#activities/pr-review-eval/significance.ts";
import type { EvalDiscordActivities } from "#activities/pr-review-eval/discord-post.ts";
import type { EvalExperimentMetricsActivities } from "#activities/pr-review-eval/experiment-metrics.ts";

const significance = proxyActivities<EvalSignificanceActivities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

const discord = proxyActivities<EvalDiscordActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

const metrics = proxyActivities<EvalExperimentMetricsActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

export type WeeklySignificanceWorkflowInput = {
  /** Optional override — when present, runs only against the given
   *  experiment ids. Default (undefined / empty) runs every active
   *  experiment from the registry. Used for `temporal workflow
   *  start` one-shots when validating a single experiment. */
  experimentIds?: string[];
  /** Optional ISO-8601 window start override. Used to backfill
   *  reports for past weeks. */
  windowStart?: string;
};

export type WeeklySignificanceWorkflowResult = {
  experimentsReported: number;
  discordPostsSent: number;
  discordPostsFailed: number;
};

export async function prReviewWeeklySignificanceWorkflow(
  input: WeeklySignificanceWorkflowInput = {},
): Promise<WeeklySignificanceWorkflowResult> {
  const explicit = input.experimentIds ?? [];
  // Always go through the activity registry — workflows can't import
  // ACTIVE_EXPERIMENTS directly (the registry file pulls in node:crypto
  // for `assignVariant`, which is non-deterministic from a workflow's
  // perspective). The metrics activity returns the registry as a side
  // effect — explicit but tidy.
  const ids =
    explicit.length > 0
      ? explicit
      : await metrics.prReviewListActiveExperimentIds();

  let reported = 0;
  let posted = 0;
  let failed = 0;
  for (const id of ids) {
    const report = await significance.prReviewComputeSignificance({
      experimentId: id,
      ...(input.windowStart === undefined
        ? {}
        : { windowStart: input.windowStart }),
    });
    await metrics.prReviewEmitExperimentMetrics({ report });
    const postResult = await discord.prReviewPostDiscordReport({ report });
    if (postResult.posted) {
      posted++;
    } else {
      failed++;
    }
    reported++;
  }

  return {
    experimentsReported: reported,
    discordPostsSent: posted,
    discordPostsFailed: failed,
  };
}
