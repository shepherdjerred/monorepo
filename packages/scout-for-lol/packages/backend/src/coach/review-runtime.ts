import { TRPCError } from "@trpc/server";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { ScoutCoachReviewInput } from "@scout-for-lol/temporal";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { assertExploreAccess } from "#src/explore/access.ts";
import { resolveResultEvidence } from "#src/evidence/results.ts";
import {
  ExploreRunRateLimitedError,
  exploreRunManager,
} from "#src/explore/runs/run-manager.ts";
import { createLogger } from "#src/logger.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutCoachReview } from "#src/temporal/starts.ts";
import { reconcileCoachReviews } from "./review-reconcile.ts";
import {
  REVIEW_KIND,
  reviewReady,
  splitMatchId,
  type CoachReviewDependencies,
} from "./review.ts";

const logger = createLogger("coach-review-runtime");

/** The production wiring of the review's dependencies. */
export function coachReviewDependencies(): CoachReviewDependencies {
  return {
    client: prisma,
    guildIds: async (ownerId) => {
      const user = await prisma.user.findUnique({
        where: { discordId: ownerId },
      });
      if (user === null) return null;
      try {
        return await assertExploreAccess(user);
      } catch (error) {
        // Explore closed to this owner is a skip; an upstream outage is not.
        if (error instanceof TRPCError && error.code === "FORBIDDEN") {
          return null;
        }
        throw error;
      }
    },
    coachEnabled: async (ownerId, guildIds) => {
      if (await isPolicyEnabled("scout_desktop_coach", { user: ownerId })) {
        return true;
      }
      for (const server of guildIds) {
        if (await isPolicyEnabled("scout_desktop_coach", { server })) {
          return true;
        }
      }
      return false;
    },
    matchParticipants: async (matchId) => {
      const resolution = await resolveResultEvidence(matchId, []);
      // The review reads Riot match documents from the lake and refuses client
      // end-of-game records, so client-only evidence is not yet reviewable;
      // the evidence trigger and the schedule retry once the Riot record lands.
      return resolution.kind === "available" &&
        resolution.value.source === "RIOT"
        ? resolution.value.participants.flatMap((player) =>
            player.identity.kind === "riot" ? [player.identity.puuid] : [],
          )
        : null;
    },
    startRun: async (ownerId, request, guildIds, coach) =>
      await exploreRunManager.start(
        { userId: ownerId },
        request,
        [...guildIds],
        { surface: "desktop", coach },
      ),
    durableOutcome: async (runId, ownerId) =>
      await exploreRunManager.durableOutcome(runId, ownerId),
    isQuotaRefusal: (error) => error instanceof ExploreRunRateLimitedError,
  };
}

/**
 * Start the post-game review Workflow for one owner and game when both of its
 * inputs exist. Called when a recording is stored and when match evidence is
 * stored, so whichever arrives second starts it; the Workflow ID is derived
 * from owner and match, so both arriving, or either retrying, is one review.
 */
export async function triggerCoachReview(
  input: Omit<ScoutCoachReviewInput, "stage">,
  deps: CoachReviewDependencies = coachReviewDependencies(),
): Promise<"started" | "not_ready"> {
  const ownerId = DiscordAccountIdSchema.parse(input.ownerId);
  if (!(await reviewReady(deps, ownerId, input.matchId))) {
    return "not_ready";
  }
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error("Temporal is unavailable for the post-game review");
  }
  await startScoutCoachReview(supervisor.client(), {
    ...input,
    stage: configuration.environment,
  });
  return "started";
}

/** A live-game recording was stored: review that game if its match is known. */
export async function onLiveGameRecordingStored(input: {
  readonly ownerId: string;
  readonly platformId: string | null;
  readonly gameId: string | null;
}): Promise<void> {
  if (input.platformId === null || input.gameId === null) {
    logger.warn("stored a live game recording that names no game");
    return;
  }
  await triggerCoachReview({
    ownerId: input.ownerId,
    matchId: `${input.platformId}_${input.gameId}`,
  });
}

/** Match evidence was stored: review it for every owner who recorded it. */
export async function onMatchEvidenceStored(matchId: string): Promise<void> {
  const parts = splitMatchId(matchId);
  if (parts === null) return;
  const recordings = await prisma.scoutClientObservation.findMany({
    where: {
      kind: "live_game_recording",
      disposition: "ACCEPTED",
      gameId: parts.gameId,
      platformId: parts.platform,
    },
    select: { device: { select: { ownerId: true } } },
  });
  const owners = new Set(recordings.map((row) => row.device.ownerId));
  for (const ownerId of owners) {
    await triggerCoachReview({ ownerId, matchId });
  }
}

/**
 * The scheduled repair (`scoutIngestionReconciliationWorkflow`, every
 * minute): start the review for every recorded game whose review never began,
 * so a start that failed in either trigger is retried by the schedule rather
 * than waiting for the recording to be re-sent.
 */
export async function reconcileCoachReviewStarts(): Promise<void> {
  const deps = coachReviewDependencies();
  const result = await reconcileCoachReviews(
    {
      client: prisma,
      trigger: async (input) => await triggerCoachReview(input, deps),
      now: () => new Date(),
    },
    REVIEW_KIND,
  );
  if (result.started > 0) {
    logger.info(
      `started ${String(result.started)} post-game review(s) the triggers missed`,
    );
  }
}
