// DB fetch for the "player history" review context. Pulls the reviewed player's
// recent games, solo-queue rank trajectory, and co-tracked teammate results,
// then delegates to the pure aggregator/formatter in player-history-signals.ts.
//
// Best-effort: the caller wraps this so a history failure never blocks a review.

import { z } from "zod";
import {
  parseLane,
  RankSchema,
  type Rank,
  type LeaguePuuid,
  type MatchId,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  computePlayerHistorySignals,
  formatPlayerHistory,
  type HistoryGame,
  type RankPoint,
  type TeammateResult,
  type CurrentGameContext,
} from "#src/league/review/player-history-signals.ts";

const logger = createLogger("player-history");

const WINDOW_SIZE = 30;

const TeamPositionSchema = z.object({ teamPosition: z.string() }).loose();

function laneFromRawParticipant(
  rawParticipantJson: string,
): HistoryGame["lane"] {
  try {
    const parsed = TeamPositionSchema.safeParse(JSON.parse(rawParticipantJson));
    if (!parsed.success) {
      return undefined;
    }
    return parseLane(parsed.data.teamPosition);
  } catch {
    return undefined;
  }
}

function parseRankJson(value: string | null): Rank | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = RankSchema.safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : undefined;
}

async function resolveIdentity(
  client: ExtendedPrismaClient,
  puuid: LeaguePuuid,
  targetServerIds: DiscordGuildId[] | undefined,
) {
  const accounts = await client.account.findMany({
    where: { puuid },
    include: { player: true },
  });
  const scoped =
    targetServerIds !== undefined && targetServerIds.length > 0
      ? accounts.filter((account) => targetServerIds.includes(account.serverId))
      : accounts;
  const chosen = scoped[0] ?? accounts[0];
  if (chosen === undefined) {
    return;
  }
  return { serverId: chosen.serverId, playerId: chosen.player.id };
}

async function fetchTeammateResults(
  client: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  puuid: LeaguePuuid,
  games: HistoryGame[],
): Promise<TeammateResult[]> {
  if (games.length === 0) {
    return [];
  }
  const teamByMatch = new Map<string, number>(
    games.map((g) => [g.matchId, g.teamId]),
  );
  const rows = await client.matchParticipantFact.findMany({
    where: {
      serverId,
      matchId: { in: games.map((g) => g.matchId) },
      puuid: { not: puuid },
    },
    select: { matchId: true, teamId: true, win: true, playerAlias: true },
  });
  const teammates: TeammateResult[] = [];
  for (const row of rows) {
    if (teamByMatch.get(row.matchId) === row.teamId) {
      teammates.push({ alias: row.playerAlias, win: row.win });
    }
  }
  return teammates;
}

export type PlayerHistoryContext = {
  /** The formatted labeled block for the prompt; "" when no usable history. */
  text: string;
  /** Champion pool (recent) + this-game champ, for patch-notes cross-reference. */
  poolChampions: string[];
};

/**
 * Fetch + compute + format the player-history block for the reviewed player.
 * `text` is "" when there's no usable history. Best-effort: any thrown error is
 * caught by the caller.
 */
export async function buildPlayerHistoryContext(options: {
  puuid: LeaguePuuid;
  currentMatchId: MatchId;
  currentGame: CurrentGameContext;
  targetServerIds?: DiscordGuildId[];
  now?: Date;
  client?: ExtendedPrismaClient;
}): Promise<PlayerHistoryContext> {
  const client = options.client ?? prisma;
  const identity = await resolveIdentity(
    client,
    options.puuid,
    options.targetServerIds,
  );
  if (identity === undefined) {
    logger.info(
      `No tracked account for puuid ${options.puuid}; skipping player history`,
    );
    return { text: "", poolChampions: [] };
  }

  const factRows = await client.matchParticipantFact.findMany({
    where: {
      serverId: identity.serverId,
      playerId: identity.playerId,
      matchId: { not: options.currentMatchId },
    },
    orderBy: { gameCreationAt: "desc" },
    take: WINDOW_SIZE,
  });
  const games: HistoryGame[] = factRows.map((row) => ({
    matchId: row.matchId,
    gameCreationAt: row.gameCreationAt,
    championName: row.championName,
    lane: laneFromRawParticipant(row.rawParticipantJson),
    queue: row.queue ?? undefined,
    win: row.win,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    creepScore: row.creepScore,
    durationSeconds: row.durationSeconds,
    teamId: row.teamId,
  }));

  const rankRows = await client.matchRankHistory.findMany({
    where: { puuid: options.puuid, queueType: "solo" },
    orderBy: { matchGameEndAt: "desc" },
    take: WINDOW_SIZE,
  });
  const rankPoints: RankPoint[] = rankRows.flatMap((row) => {
    if (row.matchGameEndAt === null) {
      return [];
    }
    return [
      {
        matchGameEndAt: row.matchGameEndAt,
        rankBefore: parseRankJson(row.rankBefore),
        rankAfter: parseRankJson(row.rankAfter),
      },
    ];
  });

  const teammates = await fetchTeammateResults(
    client,
    identity.serverId,
    options.puuid,
    games,
  );

  const signals = computePlayerHistorySignals({
    games,
    rankPoints,
    teammates,
    currentGame: options.currentGame,
    now: options.now ?? new Date(),
  });
  const poolChampions = [
    ...new Set([
      options.currentGame.championName,
      ...signals.championPool.map((rec) => rec.champion),
    ]),
  ];
  return { text: formatPlayerHistory(signals), poolChampions };
}
