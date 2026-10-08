import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";

/**
 * Activities the retired v1 pipeline and its ownership routers declared,
 * still registered on the realtime queue for one release.
 *
 * Workflow code and Activity workers deploy separately: beta routes Workflow
 * tasks to a Worker Deployment build that predates this change, and that
 * bundle can still schedule these names. An unregistered name fails every
 * attempt, so each one stays registered until every routed bundle is one that
 * no longer declares it.
 *
 * The ownership reads answer exactly as they did once the ownership flags were
 * retired: the durable pipeline owns every pass, and no claim backs the
 * answer, so a renewal or release finds nothing held. The v1 Activities have
 * no implementation left; a bundle reaches them only through a v1 handoff the
 * ownership reads no longer make, so reaching one is a broken contract and
 * fails without retrying.
 */
function retiredV1Activity(name: string): () => Promise<never> {
  return () =>
    Promise.reject(
      ApplicationFailure.nonRetryable(
        `${name} belonged to the retired v1 match pipeline and has no implementation`,
        "RetiredV1Activity",
      ),
    );
}

const notHeld = () => Promise.resolve({ outcome: "not-held" } as const);

export const RETIRED_REALTIME_ACTIVITIES = {
  resolvePostMatchDiscoveryOwnerV2: () =>
    Promise.resolve({ decision: "run-v2" } as const),
  renewPostMatchPollClaimV2: notHeld,
  releasePostMatchPollClaimV2: notHeld,
  resolvePrematchPassOwnerV2: () => {
    const info = Context.current().info;
    const run = info.workflowExecution;
    if (run === undefined) {
      throw new Error(
        "resolvePrematchPassOwnerV2 ran outside a Workflow, so there is no run to name as the pass holder",
      );
    }
    return Promise.resolve({
      decision: "run-v2",
      holder: run.runId,
      claimedAt: IsoInstantSchema.parse(
        new Date(info.scheduledTimestampMs).toISOString(),
      ),
    } as const);
  },
  renewPrematchPassClaimV2: notHeld,
  releasePrematchPassClaimV2: notHeld,
  pollRealtime: retiredV1Activity("pollRealtime"),
  ingestMatch: retiredV1Activity("ingestMatch"),
  reconcileIngestedMatchCursor: retiredV1Activity(
    "reconcileIngestedMatchCursor",
  ),
} as const;
