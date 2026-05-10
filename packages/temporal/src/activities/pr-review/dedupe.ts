import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

const COMPONENT = "pr-review-pipeline";

export type DedupeInput = {
  owner: string;
  repo: string;
  findings: Finding[];
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
      activity: "dedupeAgainstHistory",
      ...fields,
    }),
  );
}

async function dedupeAgainstHistoryImpl(
  input: DedupeInput,
): Promise<Finding[]> {
  return await withSpan(
    "prReview.dedupeAgainstHistory",
    {
      "findings.input": input.findings.length,
      "pr.owner": input.owner,
      "pr.repo": input.repo,
    },
    () => {
      // Phase 1: stub passthrough. Real implementation queries Redis
      // `dismissed_comments:{repo}:{path}:{kind}` and drops near-duplicates of
      // dismissed findings (cosine similarity > 0.85 on the embedded claim).
      // Tracked in Phase 9 of the SOTA plan.
      jsonLog("info", "dedupeAgainstHistory stub invoked", {
        inputCount: input.findings.length,
      });
      return Promise.resolve(input.findings);
    },
  );
}

export type DedupeActivities = typeof dedupeActivities;

export const dedupeActivities = {
  async prReviewDedupe(input: DedupeInput): Promise<Finding[]> {
    return dedupeAgainstHistoryImpl(input);
  },
};
