import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PostReviewResult } from "./post.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-pipeline";

export type TrackForLearningInput = {
  pipeline: PrReviewPipelineInput;
  findings: Finding[];
  postResult: PostReviewResult;
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
      activity: "trackForLearning",
      ...fields,
    }),
  );
}

async function trackForLearningImpl(
  input: TrackForLearningInput,
): Promise<void> {
  await withSpan(
    "prReview.trackForLearning",
    {
      "pr.number": input.pipeline.prNumber,
      "findings.count": input.findings.length,
      "comment.id": input.postResult.commentId,
    },
    () => {
      // Phase 1: stub. Real implementation writes finding ids + posted state
      // to Postgres (`homelab`) for offline labeling and continuous-eval
      // joins. Tracked in Phases 10–11 of the SOTA plan.
      jsonLog("info", "trackForLearning stub invoked", {
        prNumber: input.pipeline.prNumber,
        findingsCount: input.findings.length,
        commentId: input.postResult.commentId,
      });
      return Promise.resolve();
    },
  );
}

export type TrackActivities = typeof trackActivities;

export const trackActivities = {
  async prReviewTrack(input: TrackForLearningInput): Promise<void> {
    return trackForLearningImpl(input);
  },
};
