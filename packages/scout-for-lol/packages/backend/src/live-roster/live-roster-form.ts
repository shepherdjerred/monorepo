import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  RawSummonerLeagueListSchema,
  PlatformRouteSchema,
  platformToRegionalRoute,
  type PlatformRoute,
  type RegionalRoute,
  type Rank,
} from "@scout-for-lol/data";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  extractHttpStatus,
  isExpectedUpstreamError,
  RiotTransportError,
} from "#src/league/api/client/errors.ts";
import { getRank } from "#src/league/model/rank.ts";
import {
  LiveFormBudgetDeferred,
  type LiveFormRiotApi,
} from "#src/live-roster/live-roster-form-riot.ts";
import { liveRosterGameEnded } from "#src/live-roster/live-roster-retention.ts";
import {
  LIVE_FORM_GAME_COUNT,
  LiveRecentFormMapSchema,
  LiveRosterParticipantsSchema,
  type LiveRecentForm,
  type LiveRosterParticipant,
} from "#src/live-roster/live-roster-schema.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("live-roster-form");

/**
 * What one stranger's recent form needs of a ranked game: whether they won,
 * on which champion. Everything else in Riot's payload is read past and
 * dropped, so no part of a stranger's match is ever stored.
 */
const RankedGameSchema = z.object({
  info: z.object({
    participants: z.array(
      z.object({
        puuid: z.string(),
        championId: z.number(),
        win: z.boolean(),
      }),
    ),
  }),
});

type RankedGameResult = { championId: number; win: boolean };

export type LiveFormDependencies = {
  readonly database?: ExtendedPrismaClient;
  readonly riot: LiveFormRiotApi;
  readonly now: () => Date;
};

export type LiveFormPassResult = {
  status: "completed" | "no-roster" | "game-ended" | "already-complete";
  fetched: number;
  unavailable: number;
};

/** Newest first, as Riot lists them. */
export function summarizeRankedGames(
  games: readonly RankedGameResult[],
  currentChampionId: number,
  rank: Rank | null,
  fetchedAt: Date,
): Extract<LiveRecentForm, { status: "fetched" }> {
  const first = games[0];
  let streakLength = 0;
  if (first !== undefined) {
    for (const game of games) {
      if (game.win !== first.win) break;
      streakLength += 1;
    }
  }
  const onChampion = games.filter(
    (game) => game.championId === currentChampionId,
  );
  return {
    status: "fetched",
    games: games.length,
    wins: games.filter((game) => game.win).length,
    streak:
      first === undefined
        ? null
        : { result: first.win ? "win" : "loss", length: streakLength },
    gamesOnChampion: onChampion.length,
    winsOnChampion: onChampion.filter((game) => game.win).length,
    rank,
    fetchedAt: fetchedAt.toISOString(),
  };
}

/** Riot's answer that it will not serve this player's data, ever. */
function isDefinitiveAbsence(error: unknown): boolean {
  const status = extractHttpStatus(error);
  return status === 403 || status === 404;
}

/**
 * Turn a Riot failure into the Activity's retry decision.
 *
 * A 429, a refused budget and an upstream outage all mean "not now": the
 * players already finished stay recorded and the pass resumes after the
 * Activity's backoff. Anything else is not an expected boundary condition and
 * is rethrown as it is.
 */
export function deferralOf(error: unknown): Error | null {
  if (error instanceof LiveFormBudgetDeferred) {
    return ApplicationFailure.retryable(
      error.message,
      "LiveRosterBudgetDeferred",
    );
  }
  const status = extractHttpStatus(error);
  if (status === 429) {
    return ApplicationFailure.retryable(
      "Riot rate limited the live roster recent-form pass",
      "LiveRosterRateLimited",
    );
  }
  return isExpectedUpstreamError(status) || error instanceof RiotTransportError
    ? ApplicationFailure.retryable(
        "Riot did not answer the live roster recent-form pass",
        "LiveRosterRiotUnavailable",
      )
    : null;
}

async function fetchRankedResults(
  riot: LiveFormRiotApi,
  puuid: LeaguePuuid,
  regionalRoute: RegionalRoute,
): Promise<RankedGameResult[]> {
  const matchIds = z
    .array(RiotMatchIdSchema)
    .parse(
      await riot.rankedMatchIds(puuid, regionalRoute, LIVE_FORM_GAME_COUNT),
    );
  const results: RankedGameResult[] = [];
  for (const matchId of matchIds.slice(0, LIVE_FORM_GAME_COUNT)) {
    try {
      const game = RankedGameSchema.parse(
        await riot.match(matchId, regionalRoute),
      );
      const self = game.info.participants.find(
        (participant) => participant.puuid === puuid,
      );
      if (self === undefined) {
        throw new Error(
          `Riot's ${matchId} does not list the player it was fetched for`,
        );
      }
      results.push({ championId: self.championId, win: self.win });
    } catch (error) {
      // One game Riot withholds is one fewer game, not a failed player.
      if (!isDefinitiveAbsence(error)) throw error;
    }
  }
  return results;
}

async function fetchSoloRank(
  riot: LiveFormRiotApi,
  puuid: LeaguePuuid,
  platform: PlatformRoute,
): Promise<Rank | null> {
  const entries = RawSummonerLeagueListSchema.parse(
    await riot.leagueEntries(puuid, platform),
  );
  return getRank(entries, "RANKED_SOLO_5x5") ?? null;
}

/**
 * One stranger's summary, or `unavailable` when Riot will not serve them.
 * Throws for every outcome that should be tried again.
 */
async function fetchStrangerForm(
  participant: LiveRosterParticipant & { puuid: LeaguePuuid },
  platformId: string,
  deps: LiveFormDependencies,
): Promise<LiveRecentForm> {
  const platform = PlatformRouteSchema.parse(platformId);
  const regionalRoute = platformToRegionalRoute(platform);
  try {
    const games = await fetchRankedResults(
      deps.riot,
      participant.puuid,
      regionalRoute,
    );
    const rank = await fetchSoloRank(deps.riot, participant.puuid, platform);
    return summarizeRankedGames(
      games,
      participant.championId,
      rank,
      deps.now(),
    );
  } catch (error) {
    if (isDefinitiveAbsence(error)) {
      return { status: "unavailable", recordedAt: deps.now().toISOString() };
    }
    if (error instanceof z.ZodError) {
      // Riot answered with something this code cannot read: a boundary
      // problem for this player, recorded so it is not asked again.
      logger.error(
        `❌ Riot's answer for a live roster player failed validation`,
        error,
      );
      return { status: "unavailable", recordedAt: deps.now().toISOString() };
    }
    throw deferralOf(error) ?? error;
  }
}

/** Merge one player's summary into the row's map, atomically. */
async function storeForm(
  database: ExtendedPrismaClient,
  riotMatchId: RiotMatchId,
  puuid: string,
  form: LiveRecentForm,
): Promise<void> {
  await database.$executeRaw(
    Prisma.sql`
      UPDATE "LiveGameRoster"
      SET "recentForm" = "recentForm" || ${JSON.stringify({ [puuid]: form })}::jsonb,
          "updatedAt" = now()
      WHERE "riotMatchId" = ${riotMatchId}`,
  );
}

/**
 * Fetch the last five ranked games of every untracked player in one live game
 * and store the short summary on the roster row.
 *
 * Tracked players are skipped: Scout already holds their games, and the page
 * reads those from its own history. Players Riot hid have no PUUID to look up.
 *
 * ## Resumable
 *
 * Each player is stored as soon as they finish, and a player with an entry is
 * never asked about again, so a retry after a 429, a refused budget or an
 * outage does only the remaining work. The row is marked complete when no
 * player is left, which is what turns every later run into a no-op.
 *
 * ## It stops when the game does
 *
 * Whether the game ended is checked before every player. A roster nobody can
 * still use as a live lobby is not worth the Riot budget.
 */
export async function recordLiveRosterRecentForm(
  riotMatchId: RiotMatchId,
  deps: LiveFormDependencies,
): Promise<LiveFormPassResult> {
  const database = deps.database ?? prisma;
  const row = await database.liveGameRoster.findUnique({
    where: { riotMatchId },
  });
  const empty = { fetched: 0, unavailable: 0 };
  if (row === null) return { status: "no-roster", ...empty };
  if (row.recentFormCompletedAt !== null) {
    return { status: "already-complete", ...empty };
  }
  const participants = LiveRosterParticipantsSchema.parse(row.participants);
  const stored = LiveRecentFormMapSchema.parse(row.recentForm);
  const pending = participants.flatMap((participant) =>
    !participant.isTracked &&
    participant.puuid !== null &&
    stored[participant.puuid] === undefined
      ? [{ ...participant, puuid: participant.puuid }]
      : [],
  );

  let fetched = 0;
  let unavailable = 0;
  for (const participant of pending) {
    if (
      row.expiresAt <= deps.now() ||
      (await liveRosterGameEnded(riotMatchId, database))
    ) {
      return { status: "game-ended", fetched, unavailable };
    }
    const form = await fetchStrangerForm(participant, row.platform, deps);
    await storeForm(database, riotMatchId, participant.puuid, form);
    if (form.status === "fetched") fetched += 1;
    else unavailable += 1;
  }
  await database.liveGameRoster.updateMany({
    where: { riotMatchId, recentFormCompletedAt: null },
    data: { recentFormCompletedAt: deps.now() },
  });
  return { status: "completed", fetched, unavailable };
}
