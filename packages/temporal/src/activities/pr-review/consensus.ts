import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

const COMPONENT = "pr-review-pipeline";

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
      activity: "consensusVote",
      ...fields,
    }),
  );
}

async function consensusVoteImpl(findings: Finding[]): Promise<Finding[]> {
  return await withSpan(
    "prReview.consensusVote",
    {
      "findings.input": findings.length,
    },
    () => {
      // Phase 1: stub passthrough. Real implementation clusters findings by
      // normalized (path, line-range, kind) hash and keeps only those with
      // either ≥2/3 within-specialist agreement OR ≥2 cross-specialist
      // agreement. Tracked in Phase 3 of the SOTA plan.
      jsonLog("info", "consensusVote stub invoked", {
        inputCount: findings.length,
      });
      return Promise.resolve(findings);
    },
  );
}

export type ConsensusActivities = typeof consensusActivities;

export const consensusActivities = {
  async prReviewConsensus(findings: Finding[]): Promise<Finding[]> {
    return consensusVoteImpl(findings);
  },
};
