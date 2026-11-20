import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ScoutCoachReviewInput } from "@scout-for-lol/temporal";

/**
 * How far back the sweep looks for a recording whose review never started.
 * Both inputs of a review normally exist within minutes of the game; this is
 * the outage the sweep can repair, not a soak period.
 */
export const COACH_REVIEW_RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The most recordings one sweep reads; an overflow is picked up next tick. */
export const COACH_REVIEW_RECONCILE_BATCH = 200;

type ReviewPair = Omit<ScoutCoachReviewInput, "stage">;

export type CoachReviewSweepClient = {
  readonly scoutClientObservation: {
    findMany: (args: {
      where: {
        kind: string;
        disposition: string;
        platformId: { not: null };
        gameId: { not: null };
        receivedAt: { gte: Date };
      };
      select: {
        platformId: true;
        gameId: true;
        device: { select: { ownerId: true } };
      };
      orderBy: { receivedAt: "desc" };
      take: number;
    }) => Promise<
      {
        platformId: string | null;
        gameId: string | null;
        device: { ownerId: DiscordAccountId };
      }[]
    >;
  };
  readonly scoutCoachArtifact: {
    findMany: (args: {
      where: {
        kind: string;
        ownerId: { in: DiscordAccountId[] };
        matchId: { in: RiotMatchId[] };
      };
      select: { ownerId: true; matchId: true };
    }) => Promise<{ ownerId: DiscordAccountId; matchId: RiotMatchId }[]>;
  };
};

export type CoachReviewSweepResult = {
  /** Recordings read, as distinct owner and match pairs. */
  readonly considered: number;
  /** Pairs that already had an artifact, so a review already ran. */
  readonly alreadyReviewed: number;
  readonly started: number;
  readonly notReady: number;
};

/**
 * Start the post-game review for every game whose recording was stored and
 * whose review never began: the repair for a trigger that failed after its
 * input was durably stored, whichever of the recording and the match evidence
 * arrived second. It is the same start as the triggers use (`trigger` checks
 * that the recording and the resolved match both exist, and the Workflow ID is
 * derived from owner and match), so running it often, or alongside a trigger,
 * is one review. A pair that fails is reported after every other pair has been
 * tried, so one bad game never hides the rest.
 */
export async function reconcileCoachReviews(
  deps: {
    readonly client: CoachReviewSweepClient;
    readonly trigger: (input: ReviewPair) => Promise<"started" | "not_ready">;
    readonly now: () => Date;
  },
  reviewKind: string,
): Promise<CoachReviewSweepResult> {
  const recordings = await deps.client.scoutClientObservation.findMany({
    where: {
      kind: "live_game_recording",
      disposition: "ACCEPTED",
      platformId: { not: null },
      gameId: { not: null },
      receivedAt: {
        gte: new Date(deps.now().getTime() - COACH_REVIEW_RECONCILE_WINDOW_MS),
      },
    },
    select: {
      platformId: true,
      gameId: true,
      device: { select: { ownerId: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: COACH_REVIEW_RECONCILE_BATCH,
  });
  const pairs = new Map<
    string,
    { ownerId: DiscordAccountId; matchId: RiotMatchId }
  >();
  for (const row of recordings) {
    if (row.platformId === null || row.gameId === null) continue;
    const candidate = RiotMatchIdSchema.safeParse(
      `${row.platformId}_${row.gameId}`,
    );
    if (!candidate.success) continue;
    const matchId = candidate.data;
    const ownerId = DiscordAccountIdSchema.parse(row.device.ownerId);
    pairs.set(`${ownerId}:${matchId}`, { ownerId, matchId });
  }
  if (pairs.size === 0) {
    return { considered: 0, alreadyReviewed: 0, started: 0, notReady: 0 };
  }
  const reviewed = await deps.client.scoutCoachArtifact.findMany({
    where: {
      kind: reviewKind,
      ownerId: { in: [...new Set([...pairs.values()].map((p) => p.ownerId))] },
      matchId: { in: [...new Set([...pairs.values()].map((p) => p.matchId))] },
    },
    select: { ownerId: true, matchId: true },
  });
  const reviewedKeys = new Set(
    reviewed.map((row) => `${row.ownerId}:${row.matchId}`),
  );
  let alreadyReviewed = 0;
  let started = 0;
  let notReady = 0;
  const failures: unknown[] = [];
  for (const [key, pair] of pairs) {
    if (reviewedKeys.has(key)) {
      alreadyReviewed += 1;
      continue;
    }
    try {
      if ((await deps.trigger(pair)) === "started") started += 1;
      else notReady += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${String(failures.length)} post-game review start(s) failed during the sweep`,
    );
  }
  return { considered: pairs.size, alreadyReviewed, started, notReady };
}
