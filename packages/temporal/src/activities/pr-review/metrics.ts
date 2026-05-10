import { withSpan } from "#observability/tracing.ts";
import {
  prReviewPostedTotal,
  prReviewFindingsPerPr,
} from "#observability/metrics.ts";

const COMPONENT = "pr-review-pipeline";

export type EmitMetricsInput = {
  owner: string;
  repo: string;
  postedFindings: number;
  /** Whether the post activity created a new comment vs editing in place. */
  created: boolean;
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

async function emitMetricsImpl(input: EmitMetricsInput): Promise<void> {
  await withSpan(
    "prReview.emitMetrics",
    {
      "pr.owner": input.owner,
      "pr.repo": input.repo,
      "findings.posted": input.postedFindings,
    },
    () => {
      prReviewPostedTotal.inc({
        owner: input.owner,
        repo: input.repo,
        outcome: input.created ? "created" : "updated",
      });
      prReviewFindingsPerPr.observe(input.postedFindings);
      jsonLog("info", "emitMetrics recorded posted-findings histogram", {
        postedFindings: input.postedFindings,
        created: input.created,
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
};
