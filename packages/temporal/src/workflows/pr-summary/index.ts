import { proxyActivities } from "@temporalio/workflow";
import type { PrAgentActivities, PrAgentResult } from "#activities/pr-agent.ts";
import type {
  PrSummaryActivities,
  RunSummaryResult,
} from "#activities/pr-review/summary.ts";
import type { PrAgentInput, PrSummaryInput } from "#shared/schemas.ts";

/**
 * Legacy `claude -p`-based summary workflow. Kept on `TASK_QUEUES.DEFAULT`
 * so it runs side-by-side with `prSummaryPipeline` during the shadow-mode
 * period. The two paths use different markers — `<!-- pr-summary -->` for
 * this legacy workflow, `<!-- pr-summary-sdk -->` for the SDK path — so
 * both comments live on every non-draft PR for direct quality comparison
 * by reviewers and the eval grader. Phase 13 deletes this function
 * together with the legacy `prReview` and the Dagger code-review step.
 */
const { runPrAgent } = proxyActivities<PrAgentActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "1 minute",
  retry: {
    maximumAttempts: 2,
  },
});

export async function prSummary(input: PrAgentInput): Promise<PrAgentResult> {
  return await runPrAgent({ ...input, kind: "summary" });
}

/**
 * SDK-native Haiku 4.5 PR summary pipeline. Runs on `TASK_QUEUES.PR_SUMMARY`
 * (a third Worker instance, isolated from DEFAULT and PR_REVIEW) so a slow
 * Anthropic call can't head-of-line block HA / cron workflows or the
 * specialist pipeline.
 *
 * Timeouts:
 *  - startToClose: 4 minutes — Haiku turnarounds on typical diffs are ~10s
 *    end-to-end. 4 minutes covers cold caches, large diffs, and the
 *    comment upsert round-trip.
 *  - heartbeat: 30 seconds — activity heartbeats every 10s while the
 *    Anthropic call is in flight.
 *  - retry: max 2 attempts; first failure is almost always transient
 *    (Anthropic 5xx, GitHub abuse-detection). After two we give up and let
 *    the next push trigger a fresh attempt.
 */
const { runPrSummaryPipeline } = proxyActivities<PrSummaryActivities>({
  startToCloseTimeout: "4 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
  },
});

export async function prSummaryPipeline(
  input: PrSummaryInput,
): Promise<RunSummaryResult> {
  return await runPrSummaryPipeline(input);
}
