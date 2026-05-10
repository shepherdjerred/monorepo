import { proxyActivities } from "@temporalio/workflow";
import type { PrSummaryActivities } from "#activities/pr-review/summary.ts";
import type { RunSummaryResult } from "#activities/pr-review/summary.ts";
import type { PrSummaryInput } from "#shared/schemas.ts";

/**
 * Sibling workflow to `prReview`. Posts a Haiku-generated summary as a
 * single PR issue comment, edited in place across pushes via the
 * `<!-- pr-summary -->` marker.
 *
 * Activity timeouts:
 *  - startToClose: 4 minutes — Haiku turnarounds on a typical diff are ~10s
 *    end-to-end. 4 minutes gives generous headroom for cold caches, the
 *    occasional very large PR diff, and the comment upsert round-trip.
 *  - heartbeat: 30 seconds — activity heartbeats every 10s while the
 *    Anthropic call is in flight (see activity implementation).
 *  - retry: max 2 attempts; first failure is almost always transient
 *    (Anthropic 5xx, GitHub abuse-detection). After two we give up and let
 *    the next push trigger a fresh attempt.
 */
const { runPrSummaryWorkflow } = proxyActivities<PrSummaryActivities>({
  startToCloseTimeout: "4 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
  },
});

export async function prSummaryWorkflow(
  input: PrSummaryInput,
): Promise<RunSummaryResult> {
  return await runPrSummaryWorkflow(input);
}
