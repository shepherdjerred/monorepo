import {
  getCurrentRankedSplit,
  rankToLeaguePoints,
  TierSchema,
  type Division,
  type LeaguePuuid,
  type Rank,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * What the redesigned Player page shows beyond the games themselves: a ranked
 * climb across the current split ("This split", and an LP change on each
 * recent game) and a multi-kill in the newest game (a Highlights sticker).
 * Kept apart from the other audit fixtures; the seed calls it in two places.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Games this recent are the ones the climb is tied to. */
const RECENT_DAYS = 30;
const TIERS = TierSchema.options;
const DIVISIONS_PER_TIER = 4;
const LP_PER_DIVISION = 100;

/** Where the climb ends: the rank the audit player already has. */
export const CLIMB_END: Rank = {
  tier: "gold",
  division: 2,
  lp: 64,
  wins: 42,
  losses: 34,
};

/** Solo games played before the recent ones, to give the split a long line. */
const EARLIER_GAMES = 44;
/** Riot's largestMultiKill for the newest game: a quadra kill. */
const NEWEST_GAME_MULTI_KILL = 4;

type ClimbGame = { matchId: RiotMatchId; win: boolean; endedAt: Date };

/** A rank from the ladder's absolute LP, the inverse of `rankToLeaguePoints`. */
export function rankFromLeaguePoints(
  points: number,
  record: { wins: number; losses: number },
): Rank {
  const perTier = DIVISIONS_PER_TIER * LP_PER_DIVISION;
  const tier = TIERS[Math.floor(points / perTier)];
  if (tier === undefined) {
    throw new Error(`No tier holds ${points.toString()} ladder points`);
  }
  const inTier = points % perTier;
  const division = DIVISIONS_PER_TIER - Math.floor(inTier / LP_PER_DIVISION);
  const lp = inTier % LP_PER_DIVISION;
  return {
    tier,
    division: divisionOf(division),
    lp,
    wins: record.wins,
    losses: record.losses,
  };
}

function divisionOf(value: number): Division {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new Error(`${value.toString()} is not a division`);
}

/** What one game moves the player's LP by: a little over a win's worth. */
export function lpChange(win: boolean, index: number): number {
  return win ? 18 + (index % 5) : -(15 + (index % 4));
}

/**
 * Every rank the climb passes through, oldest first, each with the rank before
 * it. Walked backwards from `CLIMB_END` so the line always ends where the
 * audit player's rank already is. `results` is oldest first.
 */
export function climbSteps(results: readonly boolean[]): {
  before: Rank;
  after: Rank;
}[] {
  let wins = CLIMB_END.wins;
  let losses = CLIMB_END.losses;
  let after: number = rankToLeaguePoints(CLIMB_END);
  const steps: { before: Rank; after: Rank }[] = [];
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const win = results[index] ?? false;
    const afterRank = rankFromLeaguePoints(after, { wins, losses });
    if (win) wins -= 1;
    else losses -= 1;
    if (wins < 0 || losses < 0) {
      throw new Error("The audit climb has more games than the record holds");
    }
    const before = after - lpChange(win, index);
    steps.unshift({
      before: rankFromLeaguePoints(before, { wins, losses }),
      after: afterRank,
    });
    after = before;
  }
  return steps;
}

/** A fixed pattern for the games before the recent ones: about three in five won. */
const EARLIER_PATTERN = [true, true, false, true, false, true, true, false];

/**
 * The newest game of the audit player gets a quadra kill, so the Player page
 * has a Highlights sticker.
 */
export function withNewestMultiKill(
  facts: readonly TestLakeMatchFact[],
  puuid: LeaguePuuid,
): TestLakeMatchFact[] {
  const mine = facts.filter((fact) => fact.puuid === puuid);
  const newest = mine.reduce<TestLakeMatchFact | undefined>(
    (latest, fact) =>
      latest === undefined || fact.gameCreationAt > latest.gameCreationAt
        ? fact
        : latest,
    undefined,
  );
  if (newest === undefined) {
    throw new Error("The audit player has no game to give a multi-kill");
  }
  return facts.map((fact) =>
    fact === newest
      ? { ...fact, largestMultiKill: NEWEST_GAME_MULTI_KILL }
      : fact,
  );
}

/**
 * Ranked solo history for the audit player across the current split: a long
 * run of earlier games, then one row for each recent solo game in `facts`, so
 * "This split" draws a climb and each recent game carries its LP change.
 */
async function seedRankClimb(input: {
  prisma: PrismaClient;
  puuid: LeaguePuuid;
  facts: readonly TestLakeMatchFact[];
  now: Date;
}): Promise<void> {
  const since = input.now.getTime() - RECENT_DAYS * DAY_MS;
  const recent: ClimbGame[] = input.facts
    .filter(
      (fact) =>
        fact.puuid === input.puuid &&
        fact.queue === "solo" &&
        fact.gameCreationAt.getTime() >= since,
    )
    .toSorted((left, right) => +left.gameCreationAt - +right.gameCreationAt)
    .map((fact) => ({
      matchId: fact.matchId,
      win: fact.win,
      endedAt: new Date(fact.gameCreationAt.getTime() + HOUR_MS / 2),
    }));
  const firstRecent = recent[0];
  // Without recent solo games there is nothing to hang a climb on.
  if (firstRecent === undefined) return;
  const splitStart = getCurrentRankedSplit(firstRecent.endedAt).startDate;
  const earlier: ClimbGame[] = Array.from(
    { length: EARLIER_GAMES },
    (_, index) => ({
      matchId: RiotMatchIdSchema.parse(
        `NA1_${(9_460_000_000 + index).toString()}`,
      ),
      win: EARLIER_PATTERN[index % EARLIER_PATTERN.length] ?? false,
      endedAt: new Date(splitStart.getTime() + (index + 1) * HOUR_MS),
    }),
  );
  const lastEarlier = earlier.at(-1);
  if (lastEarlier !== undefined && lastEarlier.endedAt >= firstRecent.endedAt) {
    throw new Error(
      "The audit climb needs the current ranked split to be a few days old",
    );
  }
  const games = [...earlier, ...recent];
  const steps = climbSteps(games.map((game) => game.win));
  await input.prisma.matchRankHistory.createMany({
    data: games.map((game, index) => {
      const step = steps[index];
      if (step === undefined) throw new Error("A climb game has no step");
      return {
        matchId: game.matchId,
        puuid: input.puuid,
        queueType: "solo",
        rankBefore: JSON.stringify(step.before),
        rankAfter: JSON.stringify(step.after),
        matchGameCreationAt: new Date(game.endedAt.getTime() - HOUR_MS / 2),
        matchGameEndAt: game.endedAt,
        capturedAt: game.endedAt,
      };
    }),
  });
}

/**
 * The audit player's games for the lake, given everything the seed has
 * gathered: the newest one gets a quadra kill, and the ranked climb is written
 * to Postgres alongside. It wraps the whole list so it needs nothing from the
 * fixtures that built it.
 */
export async function withPlayerPageFixture(
  prisma: PrismaClient,
  puuid: LeaguePuuid,
  now: Date,
  facts: readonly TestLakeMatchFact[],
): Promise<TestLakeMatchFact[]> {
  await seedRankClimb({ prisma, puuid, facts, now });
  return withNewestMultiKill(facts, puuid);
}
