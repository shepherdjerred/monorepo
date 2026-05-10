import { withSpan } from "#observability/tracing.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { correctnessReviewer } from "./specialists/correctness.ts";

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
    async () => {
      // Phase 2: single-specialist parity baseline. Calls only the
      // correctness reviewer (the port of pr-prompts.ts's review prompt).
      // Phase 3 (owned by specialists teammate) replaces this body with
      // parallel fan-out across all five specialists, randomized diff
      // slicing, and the consensus vote stub gets a real implementation.
      jsonLog("info", "runSpecialists invoking correctnessReviewer", {
        prNumber: input.pipeline.prNumber,
      });
      const result = await correctnessReviewer({
        pipeline: input.pipeline,
        context: input.context,
      });
      jsonLog("info", "runSpecialists completed", {
        prNumber: input.pipeline.prNumber,
        findingsCount: result.findings.length,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });
      return result.findings;
    },
  );
}

export type SpecialistActivities = typeof specialistActivities;

export const specialistActivities = {
  async prReviewRunSpecialists(input: RunSpecialistsInput): Promise<Finding[]> {
    return runSpecialistsImpl(input);
  },
};
