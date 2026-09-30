import type {
  ScoutPostMatchDiscoveryOwnerV2Result,
  ScoutPostMatchPollReleaseV2Result,
  ScoutPostMatchPollRenewalV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { PostMatchDiscoveryResult } from "@scout-for-lol/temporal/contracts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { discoverPostMatchIntents } from "#src/league/tasks/postmatch/match-history-polling.ts";
import {
  claimPostMatchPoll,
  markPostMatchPollFailed,
  PostMatchPollOwnershipError,
  renewPostMatchPollClaim,
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

/**
 * A delegated v1 discovery pass that could not run.
 *
 * Thrown rather than returned as `skipped`, because v1's Workflow runs
 * maintenance after every discovery and would then close the handoff's claim
 * as a completed pass that discovered nothing. A plain Error is retryable, so
 * the Activity retries under the same claim. If it cannot run within its
 * retries, the v1 child fails and the router releases the claim.
 */
export class DelegatedPostMatchDiscoverySkippedError extends Error {
  constructor(pollOwner: Date) {
    super(
      `Delegated v1 post-match discovery under the claim taken at ${pollOwner.toISOString()} could not run: another pass holds this worker's polling flag, or the claim is no longer this pass's`,
    );
    this.name = "DelegatedPostMatchDiscoverySkippedError";
  }
}

/**
 * Discover for a v1 pass the V2 ownership gate delegated, under its claim.
 *
 * The claim is re-presented rather than opened over, which also re-asserts it
 * without resetting its renewal. `skipped` can still happen while the claim is
 * held: the worker-local polling flag is taken before the durable claim is
 * checked, so a V2 discovery that is about to be refused, running on the same
 * worker at the same moment, makes this pass skip. It also happens if the
 * claim was taken over. Either way the pass throws; see
 * {@link DelegatedPostMatchDiscoverySkippedError}.
 */
export async function discoverDelegatedPostMatchIntents(input: {
  pollOwner: Date;
}): Promise<PostMatchDiscoveryResult> {
  const discovery = await discoverPostMatchIntents({
    ownership: "durable",
    startedAt: input.pollOwner,
  });
  if (discovery.outcome === "skipped") {
    throw new DelegatedPostMatchDiscoverySkippedError(input.pollOwner);
  }
  return {
    matches: discovery.matches,
    evidenceComplete: discovery.evidenceComplete,
    ...(discovery.evidenceWatermark === undefined
      ? {}
      : { evidenceWatermark: discovery.evidenceWatermark }),
  };
}

/**
 * Keep a delegated v1 pass's claim live while the pass runs.
 *
 * The router calls this on a timer well inside the staleness bound, for as
 * long as its v1 child is open, so a pass that ingests a long backlog cannot
 * have its claim taken over by the next tick.
 */
export async function renewPostMatchPollClaimV2(input: {
  pollOwner: Date;
  renewedAt: Date;
}): Promise<ScoutPostMatchPollRenewalV2Result> {
  const renewed = await renewPostMatchPollClaim({
    owner: { startedAt: input.pollOwner },
    renewedAt: input.renewedAt,
  });
  return { outcome: renewed ? "renewed" : "not-held" };
}
