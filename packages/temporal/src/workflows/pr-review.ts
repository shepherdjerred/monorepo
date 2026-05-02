import { proxyActivities } from "@temporalio/workflow";
import type { PrAgentActivities, PrAgentResult } from "#activities/pr-agent.ts";
import type { PrAgentInput } from "#shared/schemas.ts";

const { runPrAgent } = proxyActivities<PrAgentActivities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    maximumAttempts: 2,
  },
});

export async function prReview(input: PrAgentInput): Promise<PrAgentResult> {
  return await runPrAgent({ ...input, kind: "review" });
}
