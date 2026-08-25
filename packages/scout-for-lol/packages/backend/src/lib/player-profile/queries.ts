import { z } from "zod";
import {
  RankSchema,
  leaguePointsDelta,
  type DiscordGuildId,
  type PlayerId,
  type Rank,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  PlayerLookupInput,
  getPlayerOrThrow,
  notFound,
} from "#src/lib/player-admin/shared.ts";
import {
  fetchPlayerChampionPool,
  fetchPlayerMatchHistory,
  fetchTeamTotalsForMatches,
  type LakePlayerMatchHistoryRow,
  type MatchHistoryCursor,
} from "#src/reports/duckdb/lake-reads.ts";

/**
 * Read models for the player profile surface.
 *
 * Authorization note: `resolveGuildPuuids` is the only way into the lake here.
 * The matches parquet carries no `server_id`, so the puuid list these queries
 * pass down IS the guild boundary — it comes from `getPlayerOrThrow`, which
 * looks a player up by the `(serverId, alias)` unique and returns only that
 * server's accounts. Never source puuids any other way.
 */

/**
 * Below this many games a rate is noise, so the UI labels it rather than
 * printing a confident number. Matches the pairing job's existing threshold
 * (`league/tasks/pairing/weekly-update.ts`).
 */
export const MIN_GAMES_FOR_RATE = 10;

/** Games summarised for "recent form"; also the default history page size. */
const RECENT_FORM_GAMES = 20;

const MatchHistoryCursorSchema = z.object({
  gameCreationMs: z.number().int(),
  matchId: z.string().min(1),
});

export const PlayerProfileInput = PlayerLookupInput.extend({
  queue: z.string().trim().min(1).max(50).optional(),
});

export const PlayerMatchHistoryInput = PlayerLookupInput.extend({
  limit: z.number().int().min(1).max(50).default(RECENT_FORM_GAMES),
  cursor: MatchHistoryCursorSchema.optional(),
  queue: z.string().trim().min(1).max(50).optional(),
});

type ProfileAccount = {
  puuid: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  riotIdUpdatedAt: Date | null;
  lastMatchTime: Date | null;
  lastCheckedAt: Date | null;
};

type ResolvedPlayerProfile = {
  playerId: number;
  alias: string;
  puuids: string[];
  accounts: ProfileAccount[];
};

type ResolvedGuildPlayerProfile = ResolvedPlayerProfile & {
  discordId: string | null;
};

function profileAccount(account: ProfileAccount): ProfileAccount {
  return {
    puuid: account.puuid,
    region: account.region,
    riotGameName: account.riotGameName,
    riotTagLine: account.riotTagLine,
    riotIdUpdatedAt: account.riotIdUpdatedAt,
    lastMatchTime: account.lastMatchTime,
    lastCheckedAt: account.lastCheckedAt,
  };
}

async function resolveGuildPuuids(input: {
  guildId: string;
  alias: string;
}): Promise<ResolvedGuildPlayerProfile> {
  const player = await getPlayerOrThrow(input);
  return {
    playerId: player.id,
    alias: player.alias,
    discordId: player.discordId,
    puuids: player.accounts.map((account) => account.puuid),
    accounts: player.accounts.map((account) => profileAccount(account)),
  };
}

async function resolveConsumerPlayerPuuids(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
}): Promise<ResolvedPlayerProfile & { guildId: string }> {
  const player = await prisma.player.findFirst({
    where: { id: input.playerId, serverId: { in: input.guildIds } },
    include: { accounts: true },
  });
  if (player === null) {
    throw notFound("Player was not found");
  }
  return {
    playerId: player.id,
    alias: player.alias,
    guildId: player.serverId,
    puuids: player.accounts.map((account) => account.puuid),
    accounts: player.accounts.map((account) => profileAccount(account)),
  };
}

function parseRank(serialized: string | null): Rank | undefined {
  if (serialized === null) return undefined;
  const parsed = RankSchema.safeParse(JSON.parse(serialized));
  return parsed.success ? parsed.data : undefined;
}

/** Latest known rank per queue, newest game first. */
async function latestRanks(puuids: string[]): Promise<{
  solo: Rank | undefined;
  flex: Rank | undefined;
  ranked5s: Rank | undefined;
}> {
  const [rankHistory, current] = await Promise.all([
    Promise.all(
      (["solo", "flex", "ranked 5s"] as const).map(async (queueType) =>
        prisma.matchRankHistory.findFirst({
          where: {
            puuid: { in: puuids },
            queueType,
            rankAfter: { not: null },
          },
          orderBy: [
            { matchGameEndAt: { sort: "desc", nulls: "last" } },
            { capturedAt: "desc" },
          ],
        }),
      ),
    ),
    prisma.currentRankSnapshot.findMany({
      where: { puuid: { in: puuids } },
      orderBy: { fetchedAt: "desc" },
    }),
  ]);

  function newestRank(
    live: (typeof rankHistory)[number] | undefined,
    queueType: "solo" | "flex" | "ranked 5s",
  ): Rank | undefined {
    const snapshot = current.find((entry) => {
      if (queueType === "solo") return entry.soloRank !== null;
      if (queueType === "flex") return entry.flexRank !== null;
      return entry.ranked5sRank !== null;
    });
    const snapshotValue =
      queueType === "solo"
        ? snapshot?.soloRank
        : queueType === "flex"
          ? snapshot?.flexRank
          : snapshot?.ranked5sRank;
    if (
      snapshot !== undefined &&
      (live == null || snapshot.fetchedAt > live.capturedAt)
    ) {
      return parseRank(snapshotValue ?? null);
    }
    return parseRank(live?.rankAfter ?? null);
  }

  return {
    solo: newestRank(rankHistory[0], "solo"),
    flex: newestRank(rankHistory[1], "flex"),
    ranked5s: newestRank(rankHistory[2], "ranked 5s"),
  };
}

export type MatchHistoryEntry = {
  matchId: string;
  gameCreationMs: number;
  gameDurationSeconds: number;
  queue: string | null;
  championId: number;
  championName: string;
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  csPerMinute: number;
  visionScore: number;
  goldEarned: number;
  /** Null when the team's totals are absent — never silently 0. */
  killParticipation: number | null;
  damageShare: number | null;
  /** LP change for this game; null unless both before and after are known. */
  leaguePointsDelta: number | null;
  account: {
    gameName: string | null;
    tagLine: string | null;
    region: string;
  };
};

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * Attach team-relative and rank-relative context to raw lake rows.
 *
 * Team totals come from a separate match-scoped query because the history rows
 * themselves are puuid-filtered and therefore cannot see teammates.
 */
async function decorateHistoryRows(
  rows: LakePlayerMatchHistoryRow[],
  accounts: ProfileAccount[],
): Promise<MatchHistoryEntry[]> {
  if (rows.length === 0) return [];
  const matchIds = rows.map((row) => row.match_id);
  const puuids = accounts.map((account) => account.puuid);

  const [teamTotals, rankRows] = await Promise.all([
    fetchTeamTotalsForMatches({ matchIds }),
    prisma.matchRankHistory.findMany({
      where: { matchId: { in: matchIds }, puuid: { in: puuids } },
    }),
  ]);

  const totalsByKey = new Map(
    teamTotals.map((total) => [
      `${total.match_id}:${total.team_id.toString()}`,
      total,
    ]),
  );
  const rankByMatchAndPuuid = new Map(
    rankRows.map((row) => [`${row.matchId}:${row.puuid}`, row]),
  );
  const accountByPuuid = new Map(
    accounts.map((account) => [account.puuid, account]),
  );

  return rows.map((row) => {
    const totals = totalsByKey.get(`${row.match_id}:${row.team_id.toString()}`);
    const rankRow = rankByMatchAndPuuid.get(`${row.match_id}:${row.puuid}`);
    const account = accountByPuuid.get(row.puuid);
    if (account === undefined) {
      throw new Error(`Match history returned an unrequested PUUID`);
    }
    const before = parseRank(rankRow?.rankBefore ?? null);
    const after = parseRank(rankRow?.rankAfter ?? null);
    const minutes = row.time_played / 60;

    return {
      matchId: row.match_id,
      gameCreationMs: row.game_creation_ms,
      gameDurationSeconds: row.game_duration_seconds,
      queue: row.queue,
      championId: row.champion_id,
      championName: row.champion_name,
      teamPosition: row.team_position,
      win: row.win,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      creepScore: row.creep_score,
      csPerMinute: minutes > 0 ? row.creep_score / minutes : 0,
      visionScore: row.vision_score,
      goldEarned: row.gold_earned,
      killParticipation:
        totals === undefined
          ? null
          : ratio(row.kills + row.assists, totals.team_kills),
      damageShare:
        totals === undefined
          ? null
          : ratio(
              row.total_damage_dealt_to_champions,
              totals.team_damage_to_champions,
            ),
      leaguePointsDelta:
        before === undefined || after === undefined
          ? null
          : leaguePointsDelta(before, after),
      account: {
        gameName: account.riotGameName,
        tagLine: account.riotTagLine,
        region: account.region,
      },
    };
  });
}

async function matchHistoryForPlayer(
  player: ResolvedPlayerProfile,
  input: {
    limit: number;
    cursor?: MatchHistoryCursor;
    queue?: string;
  },
): Promise<{
  entries: MatchHistoryEntry[];
  nextCursor: MatchHistoryCursor | null;
}> {
  if (player.puuids.length === 0) {
    return { entries: [], nextCursor: null };
  }

  const rows = await fetchPlayerMatchHistory({
    puuids: player.puuids,
    limit: input.limit + 1,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.queue === undefined ? {} : { queue: input.queue }),
  });
  const page = rows.slice(0, input.limit);
  const last = rows.length > input.limit ? page.at(-1) : undefined;

  return {
    entries: await decorateHistoryRows(page, player.accounts),
    nextCursor:
      last === undefined
        ? null
        : { gameCreationMs: last.game_creation_ms, matchId: last.match_id },
  };
}

export async function getPlayerMatchHistory(
  input: z.infer<typeof PlayerMatchHistoryInput>,
): Promise<{
  entries: MatchHistoryEntry[];
  nextCursor: MatchHistoryCursor | null;
}> {
  const player = await resolveGuildPuuids(input);
  return matchHistoryForPlayer(player, {
    limit: input.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.queue === undefined ? {} : { queue: input.queue }),
  });
}

export async function getConsumerPlayerMatchHistory(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
  limit: number;
  cursor?: MatchHistoryCursor;
  queue?: string;
}) {
  const player = await resolveConsumerPlayerPuuids(input);
  return matchHistoryForPlayer(player, input);
}

export type ChampionPoolEntry = {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winRate: number;
  kda: number;
  csPerMinute: number;
  /** True when `games` is too small for the rates above to mean much. */
  lowSample: boolean;
};

async function accountSummaries(accounts: ProfileAccount[]) {
  return Promise.all(
    accounts.map(async (account) => ({
      gameName: account.riotGameName,
      tagLine: account.riotTagLine,
      region: account.region,
      riotIdUpdatedAt: account.riotIdUpdatedAt,
      lastMatchTime: account.lastMatchTime,
      lastCheckedAt: account.lastCheckedAt,
      ranks: await latestRanks([account.puuid]),
    })),
  );
}

async function profileSummaryForPlayer(
  player: ResolvedPlayerProfile,
  queue: string | undefined,
) {
  const accounts = await accountSummaries(player.accounts);
  if (player.puuids.length === 0) {
    return {
      alias: player.alias,
      accountCount: 0,
      accounts,
      riotIds: [],
      ranks: { solo: undefined, flex: undefined },
      recentForm: null,
      championPool: [],
      minGamesForRate: MIN_GAMES_FOR_RATE,
    };
  }

  const [ranks, recentRows, pool] = await Promise.all([
    latestRanks(player.puuids),
    fetchPlayerMatchHistory({
      puuids: player.puuids,
      limit: RECENT_FORM_GAMES,
      ...(queue === undefined ? {} : { queue }),
    }),
    fetchPlayerChampionPool({
      puuids: player.puuids,
      ...(queue === undefined ? {} : { queue }),
    }),
  ]);

  const recent = await decorateHistoryRows(recentRows, player.accounts);
  const participations = recent
    .map((entry) => entry.killParticipation)
    .filter((value) => value !== null);

  return {
    alias: player.alias,
    accountCount: player.puuids.length,
    accounts,
    riotIds: player.accounts
      .filter((account) => account.riotGameName !== null)
      .map((account) => ({
        gameName: account.riotGameName,
        tagLine: account.riotTagLine,
      })),
    ranks,
    recentForm:
      recent.length === 0
        ? null
        : {
            games: recent.length,
            wins: recent.filter((entry) => entry.win).length,
            kills: recent.reduce((sum, entry) => sum + entry.kills, 0),
            deaths: recent.reduce((sum, entry) => sum + entry.deaths, 0),
            assists: recent.reduce((sum, entry) => sum + entry.assists, 0),
            averageKillParticipation:
              participations.length === 0
                ? null
                : participations.reduce((sum, value) => sum + value, 0) /
                  participations.length,
          },
    championPool: pool.map((row): ChampionPoolEntry => {
      const minutes = row.time_played / 60;
      return {
        championId: row.champion_id,
        championName: row.champion_name,
        games: row.games,
        wins: row.wins,
        winRate: row.games > 0 ? row.wins / row.games : 0,
        kda:
          row.deaths === 0
            ? row.kills + row.assists
            : (row.kills + row.assists) / row.deaths,
        csPerMinute: minutes > 0 ? row.creep_score / minutes : 0,
        lowSample: row.games < MIN_GAMES_FOR_RATE,
      };
    }),
    minGamesForRate: MIN_GAMES_FOR_RATE,
  };
}

export async function getPlayerProfileSummary(
  input: z.infer<typeof PlayerProfileInput>,
) {
  const player = await resolveGuildPuuids(input);
  const summary = await profileSummaryForPlayer(player, input.queue);
  return {
    discordId: player.discordId,
    ...summary,
  };
}

export async function getConsumerPlayerProfileSummary(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
  queue?: string;
}) {
  const player = await resolveConsumerPlayerPuuids(input);
  return {
    guildId: player.guildId,
    ...(await profileSummaryForPlayer(player, input.queue)),
  };
}
