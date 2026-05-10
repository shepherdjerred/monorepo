import { withSpan } from "#observability/tracing.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { BootstrapResult } from "./bootstrap.ts";

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
      activity: "runSpecialists",
      ...fields,
    }),
  );
}

export type RunSpecialistsInput = {
  pipeline: PrReviewPipelineInput;
  context: BootstrapResult;
};

async function runSpecialistsImpl(
  input: RunSpecialistsInput,
): Promise<Finding[]> {
  return await withSpan(
    "prReview.runSpecialists",
    {
      "pr.number": input.pipeline.prNumber,
      "pr.commitSha": input.pipeline.commitSha,
    },
    () => {
      // Phase 1: stub. Real implementation fans out to 5 specialists
      // (correctness/security/performance/convention/deps) with 3 randomized
      // passes each, then returns the aggregated findings. Tracked in Phase 3
      // of packages/docs/plans/2026-05-10_sota-pr-review-bot.md.
      jsonLog("info", "runSpecialists stub invoked", {
        prNumber: input.pipeline.prNumber,
      });
      return Promise.resolve<Finding[]>([]);
    },
  );
}

export type SpecialistActivities = typeof specialistActivities;

export const specialistActivities = {
  async prReviewRunSpecialists(input: RunSpecialistsInput): Promise<Finding[]> {
    return runSpecialistsImpl(input);
  },
};
