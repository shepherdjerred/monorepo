import { WorkflowNotFoundError } from "@temporalio/client";
import type { LeaguePuuid } from "@scout-for-lol/data/index.ts";
import type {
  ScoutPrematchPassClaimV2Result,
  ScoutPrematchPassOwnerV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutStage } from "@scout-for-lol/temporal/contracts";
import { ScoutPrematchGameRefSchema } from "@scout-for-lol/temporal/contracts-v2";
import { scoutPrematchGameV2WorkflowId } from "@scout-for-lol/temporal/identifiers";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

const BOT_STATE_ID = 1;

/**
 * How long a claimed prematch pass may stand, unrenewed, before another run
 * may take it over.
 *
 * A pass is short: v1's `pollRealtime`, or V2 discovery's single scan plus
 * v1's maintenance, each bounded by the realtime queue's five-minute
 * schedule-to-close budget. The router renews every minute while its pass
 * runs, so the bound only ever frees a claim whose router was TERMINATED,
 * and it is short because every tick deferred behind it is a tick in which
 * no game start is announced.
 */
export const PREMATCH_PASS_STALE_AFTER_MS = 5 * 60 * 1000;

export type PrematchPassClaim =
  | { outcome: "claimed"; claimedAt: Date }
  | { outcome: "held"; since: Date | null };

/**
 * Claim the prematch pass for one `scoutRealtimePollWorkflow` run.
 *
 * One guarded statement: the claim applies only when no live run holds the
 * pass. Of two concurrent claimants, exactly one updates the row, and the
 * other reads back who holds it. A row that does not exist yet is created,
 * and a rival that created it first sends this attempt back through the same
 * guard.
 *
 * The holder re-presenting its own claim wins it again, which is what makes a
 * retried ownership Activity work: the run ID is the same on every attempt,
 * so an attempt that claimed and then died leaves a claim its own retry
 * re-acquires instead of one it defers behind.
 *
 * The claimable cases are spelled out rather than negated, for the null
 * safety `claimPostMatchPoll` explains: a holder with no claim instant has
 * no age anyone could judge, so it is claimable rather than a permanent
 * wedge.
 */
export async function claimPrematchPass(
  input: {
    holder: string;
    claimedAt: Date;
    now: Date;
    staleAfterMs?: number;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PrematchPassClaim> {
  const staleAfterMs = input.staleAfterMs ?? PREMATCH_PASS_STALE_AFTER_MS;
  const staleBefore = new Date(input.now.getTime() - staleAfterMs);
  const retaken = await prismaClient.botState.updateMany({
    where: { id: BOT_STATE_ID, prematchPassHolder: input.holder },
    data: { prematchPassHolder: input.holder },
  });
  if (retaken.count === 1) {
    return { outcome: "claimed", claimedAt: input.claimedAt };
  }
  const opening = {
    prematchPassHolder: input.holder,
    prematchPassClaimedAt: input.claimedAt,
    prematchPassRenewedAt: null,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await prismaClient.botState.updateMany({
      where: {
        id: BOT_STATE_ID,
        OR: [
          { prematchPassHolder: null },
          { prematchPassClaimedAt: null },
          {
            prematchPassClaimedAt: { lt: staleBefore },
            OR: [
              { prematchPassRenewedAt: null },
              { prematchPassRenewedAt: { lt: staleBefore } },
            ],
          },
        ],
      },
      data: opening,
    });
    if (claimed.count === 1) {
      return { outcome: "claimed", claimedAt: input.claimedAt };
    }
    const standing = await prismaClient.botState.findUnique({
      where: { id: BOT_STATE_ID },
    });
    if (standing !== null) {
      return { outcome: "held", since: standing.prematchPassClaimedAt };
    }
    const created = await prismaClient.botState.createMany({
      data: [{ id: BOT_STATE_ID, ...opening }],
      skipDuplicates: true,
    });
    if (created.count === 1) {
      return { outcome: "claimed", claimedAt: input.claimedAt };
    }
    // A rival created the row between the update and the insert; the next
    // attempt reads what they wrote through the same guard.
  }
  throw new Error(
    "Could not claim the prematch pass: the BotState row kept changing under both the update and the insert",
  );
}

/**
 * Keep a held prematch pass claim live past the staleness bound.
 *
 * Applied only while the row still names `holder`, so renewing never revives
 * a claim that was released or taken over.
 */
export async function renewPrematchPassClaim(
  input: { holder: string; renewedAt: Date },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const renewed = await prismaClient.botState.updateMany({
    where: { id: BOT_STATE_ID, prematchPassHolder: input.holder },
    data: { prematchPassRenewedAt: input.renewedAt },
  });
  return renewed.count === 1;
}

/**
 * Free the prematch pass, only if `holder` still holds it.
 *
 * A router whose claim went stale and was taken over must not free the
 * claim of the run that took it, so the release is guarded exactly as the
 * renewal is.
 */
export async function releasePrematchPassClaim(
  input: { holder: string },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const released = await prismaClient.botState.updateMany({
    where: { id: BOT_STATE_ID, prematchPassHolder: input.holder },
    data: {
      prematchPassHolder: null,
      prematchPassClaimedAt: null,
      prematchPassRenewedAt: null,
    },
  });
  return released.count === 1;
}

/**
 * Decide which pipeline owns one prematch pass, and claim the pass for it.
 *
 * `scout_v2_prematch_ownership_enabled` answers, per environment, and is off
 * by default: v1 keeps detection until an operator ramps the stage. Either
 * way the run takes the durable pass claim before any detection starts, so a
 * scheduled pass and an operator's, or the last v1 pass and the first V2 one
 * after a flip, can never both detect the same game. A run that finds the
 * claim held defers.
 *
 * `holder` must be stable across this Activity's retries and unique to the
 * run, which the Workflow run ID is.
 */
export async function resolvePrematchPassOwnerV2(input: {
  holder: string;
  claimedAt: Date;
  now: Date;
}): Promise<ScoutPrematchPassOwnerV2Result> {
  const v2Owns = await isPolicyEnabled("scout_v2_prematch_ownership_enabled");
  const claim = await claimPrematchPass(input);
  if (claim.outcome === "held") {
    return {
      decision: "defer",
      heldSince:
        claim.since === null
          ? null
          : IsoInstantSchema.parse(claim.since.toISOString()),
    };
  }
  return {
    decision: v2Owns ? "run-v2" : "run-v1",
    holder: input.holder,
    claimedAt: IsoInstantSchema.parse(claim.claimedAt.toISOString()),
  };
}

export async function renewPrematchPassClaimV2(input: {
  holder: string;
  renewedAt: Date;
}): Promise<ScoutPrematchPassClaimV2Result> {
  return {
    outcome: (await renewPrematchPassClaim(input)) ? "renewed" : "not-held",
  };
}

export async function releasePrematchPassClaimV2(input: {
  holder: string;
}): Promise<ScoutPrematchPassClaimV2Result> {
  return {
    outcome: (await releasePrematchPassClaim(input)) ? "released" : "not-held",
  };
}

/**
 * The V2 capture Workflow statuses that leave a game free to be announced.
 *
 * They are the statuses `ALLOW_DUPLICATE_FAILED_ONLY` lets V2 discovery
 * itself replace, so v1 treats a game exactly as V2 would: a capture that
 * died is not a claim on the game. Every other status — running, completed,
 * or one this code does not know — means V2 took the game, and v1 answering
 * "taken" for an unknown status errs toward announcing at most once.
 */
const REPLACEABLE_CAPTURE_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
]);

/**
 * Whether the V2 prematch path already took this game.
 *
 * v1 asks before it announces a game it has not tracked, because V2 does not
 * write the `ActiveGame` row v1 deduplicates on. V2's own dedup is the
 * per-game Workflow ID, so that ID is the one fact both pipelines can read:
 * an execution under it that is running or completed has captured, or is
 * capturing, the game and minted its notification intents. After the flag
 * flips back to v1 mid-game, v1 skips such a game rather than announcing it
 * and opening its markets a second time.
 *
 * An unavailable Temporal client is a broken contract on the realtime worker,
 * not a "no", so it throws. The v1 loop reports it per player and the next
 * tick asks again.
 */
export async function isPrematchGameCapturedByV2(
  stage: ScoutStage,
  game: { platformId: string; gameId: number; puuid: LeaguePuuid },
): Promise<boolean> {
  const workflowId = scoutPrematchGameV2WorkflowId(
    stage,
    ScoutPrematchGameRefSchema.parse({
      puuid: game.puuid,
      platform: game.platformId,
      gameId: game.gameId.toString(),
    }),
  );
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error(
      `Temporal supervisor is unavailable while reading ${workflowId}`,
    );
  }
  try {
    const description = await supervisor
      .client()
      .workflow.getHandle(workflowId)
      .describe();
    return !REPLACEABLE_CAPTURE_STATUSES.has(description.status.name);
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) return false;
    throw error;
  }
}
