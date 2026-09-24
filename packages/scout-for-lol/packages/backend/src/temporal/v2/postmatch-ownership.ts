import type {
  ScoutPostMatchDiscoveryOwnerV2Result,
  ScoutPostMatchPollReleaseV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  claimPostMatchPoll,
  markPostMatchPollFailed,
  PostMatchPollOwnershipError,
} from "#src/league/tasks/recovery/app-state.ts";

/**
 * Decide which pipeline owns one post-match discovery pass.
 *
 * `scout_v2_postmatch_ownership_enabled` answers first, per environment, and
 * is on by default: V2 keeps discovery unless an operator turns it off.
 *
 * When it is off, the handoff to v1 takes the same durable poll claim V2
 * discovery takes, before any v1 work starts. The claim is one guarded
 * statement, so of two overlapping handoffs (a scheduled run and an
 * operator's, say), or a handoff and a V2 run, exactly one owns the pass and
 * the other is told the poll is held. The v1 child then runs under the claim
 * and its maintenance closes it. The staleness bound still frees a claim that
 * a terminated run left behind.
 *
 * `claimAt` must be stable across this Activity's retries, so a retried
 * attempt re-acquires the claim its predecessor took.
 */
export async function resolvePostMatchDiscoveryOwnerV2(input: {
  claimAt: Date;
}): Promise<ScoutPostMatchDiscoveryOwnerV2Result> {
  if (await isPolicyEnabled("scout_v2_postmatch_ownership_enabled")) {
    return { decision: "run-v2" };
  }
  const claim = await claimPostMatchPoll({ startedAt: input.claimAt });
  if (claim.outcome === "claimed") {
    return {
      decision: "delegate-v1",
      pollOwner: IsoInstantSchema.parse(claim.owner.startedAt.toISOString()),
    };
  }
  return {
    decision: "defer-v1",
    pollHeldSince:
      claim.since === null
        ? null
        : IsoInstantSchema.parse(claim.since.toISOString()),
  };
}

/**
 * Close a delegated v1 pass's claim as failed, when the pass itself did not.
 *
 * Only the Workflow's failure path calls this. v1's maintenance, or its
 * discovery's own failure path, usually closed the claim already, and then
 * the guarded close finds nothing to close: that is `not-held`, not an error.
 */
export async function releasePostMatchPollClaimV2(input: {
  pollOwner: Date;
  releasedAt: Date;
}): Promise<ScoutPostMatchPollReleaseV2Result> {
  try {
    await markPostMatchPollFailed(
      new Error("The delegated v1 post-match discovery pass failed"),
      input.releasedAt,
      { owner: { startedAt: input.pollOwner } },
    );
    return { outcome: "released" };
  } catch (error) {
    if (error instanceof PostMatchPollOwnershipError) {
      return { outcome: "not-held" };
    }
    throw error;
  }
}
