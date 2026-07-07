// Fetch for the "player history" review context. Pulls the reviewed player's
// recent games and co-tracked teammate results from the report lake (parquet
// ∪ ingest staging, so a game finished minutes ago is already visible), the
// solo-queue rank trajectory from Prisma, then delegates to the pure
// aggregator/formatter in player-history-signals.ts.
//
// Best-effort: the caller wraps this so a history failure never blocks a review.

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
  fetchRecentGamesForPuuids,
  fetchTeamRowsForMatches,
} from "#src/reports/duckdb/lake-reads.ts";
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
  // Tracked identities come from Prisma live (no snapshot staleness); the
  // lake rows are global, so the tracked-puuid list is what scopes results
  // to this server's players.
  const trackedAccounts = await client.account.findMany({
    where: { serverId },
    include: { player: true },
  });
  const aliasByPuuid = new Map<string, string>(
    trackedAccounts.map((account) => [account.puuid, account.player.alias]),
  );
  const teamByMatch = new Map<string, number>(
    games.map((g) => [g.matchId, g.teamId]),
  );
  const rows = await fetchTeamRowsForMatches({
    matchIds: games.map((g) => g.matchId),
    puuids: [...aliasByPuuid.keys()],
    excludePuuid: puuid,
  });
  const teammates: TeammateResult[] = [];
  for (const row of rows) {
    const alias = aliasByPuuid.get(row.puuid);
    if (alias !== undefined && teamByMatch.get(row.match_id) === row.team_id) {
      teammates.push({ alias, win: row.win });
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

  // All of the player's tracked accounts on this server (multi-account
  // players get their full history, matching the old playerId fact filter).
  const identityAccounts = await client.account.findMany({
    where: { serverId: identity.serverId, playerId: identity.playerId },
    select: { puuid: true },
  });
  const lakeRows = await fetchRecentGamesForPuuids({
    puuids: identityAccounts.map((account) => account.puuid),
    excludeMatchId: options.currentMatchId,
    limit: WINDOW_SIZE,
  });
  const games: HistoryGame[] = lakeRows.map((row) => ({
    matchId: row.match_id,
    gameCreationAt: new Date(row.game_creation_ms),
    championName: row.champion_name,
    lane: parseLane(row.team_position),
    queue: row.queue ?? undefined,
    win: row.win,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    creepScore: row.creep_score,
    durationSeconds: row.game_duration_seconds,
    teamId: row.team_id,
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
