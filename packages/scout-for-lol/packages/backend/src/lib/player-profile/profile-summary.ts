import {
  computeKda,
  LOW_SAMPLE_GAME_THRESHOLD,
  PlayerProfileGameWindowSchema,
  PlayerProfileQueueSelectionSchema,
  type DiscordGuildId,
  type PlayerId,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { accountSummaries } from "#src/lib/player-profile/account-summaries.ts";
import { buildPlayerBehavior } from "#src/lib/player-profile/behavior.ts";
import {
  buildChampionForm,
  buildHighlights,
  buildPlaysWith,
  CHAMPION_FORM_CHAMPIONS,
  CHAMPION_FORM_GAMES,
  PLAYS_WITH_WINDOW_DAYS,
} from "#src/lib/player-profile/profile-extras.ts";
import {
  latestRanks,
  resolveConsumerPlayerPuuids,
  resolveGuildPuuids,
  type ResolvedPlayerProfile,
} from "#src/lib/player-profile/profile-resolution.ts";
import {
  decorateHistoryRows,
  readHistoryLakeContext,
  type PlayerProfileInput,
} from "#src/lib/player-profile/queries.ts";
import { readGuildMatchRows } from "#src/reports/duckdb/community/community-lake.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  readChampionRecentForm,
  readPlayerChampionPool,
  readPlayerMatchHistory,
} from "#src/reports/duckdb/lake-reads.ts";
import { STANDARD_COMMUNITY_QUEUES } from "#src/trpc/router/consumer/standard-rift.ts";
import type { CommunityPlayer } from "#src/trpc/router/consumer/community-insights.ts";
import type { z } from "zod";

/**
 * Below this many games a rate is noise, so the UI labels it rather than
 * printing a confident number. The domain owns the shared threshold.
 */
const MIN_GAMES_FOR_RATE = LOW_SAMPLE_GAME_THRESHOLD;

/** Games summarised for "recent form". */
const RECENT_FORM_GAMES = 20;

const DAY_MS = 86_400_000;

export type ChampionPoolEntry = {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  kda: number;
  averageKills: number;
  averageDeaths: number;
  averageAssists: number;
  averageCs: number;
  csPerMinute: number;
  damagePerMinute: number;
  averageDamage: number;
  averageVisionScore: number;
  teamPosition: string | null;
  /** True when `games` is too small for the rates above to mean much. */
  lowSample: boolean;
};

function calculatePreferredPositions(rows: { team_position: string }[]): {
  position: string;
  games: number;
  percentage: number;
}[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const pos = row.team_position.trim().toUpperCase();
    if (pos !== "INVALID" && pos !== "") {
      counts.set(pos, (counts.get(pos) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([position, games]) => ({
      position,
      games,
      percentage: Math.round((games / total) * 100),
    }))
    .sort((a, b) => b.games - a.games);
}

type ProfileFilters = {
  queue?: QueueType;
  queues?: QueueType[];
  games: PlayerProfileGameWindow;
  championGames?: PlayerProfileGameWindow;
};

/** The server's players, so shared games can be attributed to friends. */
type CommunityScope = { players: CommunityPlayer[] };

function championPoolEntries(
  pool: Awaited<ReturnType<typeof readPlayerChampionPool>>,
): ChampionPoolEntry[] {
  return pool.map((row): ChampionPoolEntry => {
    const minutes = row.time_played / 60;
    const games = row.games > 0 ? row.games : 1;
    return {
      championId: row.champion_id,
      championName: row.champion_name,
      games: row.games,
      wins: row.wins,
      losses: Math.max(0, row.games - row.wins),
      winRate: row.games > 0 ? row.wins / row.games : 0,
      kda: computeKda(row),
      averageKills: row.kills / games,
      averageDeaths: row.deaths / games,
      averageAssists: row.assists / games,
      averageCs: row.creep_score / games,
      csPerMinute: minutes > 0 ? row.creep_score / minutes : 0,
      damagePerMinute: minutes > 0 ? row.damage_to_champions / minutes : 0,
      averageDamage: row.damage_to_champions / games,
      averageVisionScore: row.vision_score / games,
      teamPosition: row.team_position,
      lowSample: row.games < MIN_GAMES_FOR_RATE,
    };
  });
}

/**
 * Every lake read a profile page makes, on the one slot it holds: the recent
 * games, the champion pool, behavior, the match-scoped context for the recent
 * games, and (for the consumer page) form on the top champions and the
 * player's shared games.
 */
async function readProfileLake(
  player: ResolvedPlayerProfile,
  filters: ProfileFilters,
  community: CommunityScope | undefined,
) {
  const queueFilters = {
    ...(filters.queue === undefined ? {} : { queue: filters.queue }),
    ...(filters.queues === undefined ? {} : { queues: filters.queues }),
  };
  return await withLakePage(undefined, async (page) => {
    const recentRows = await readPlayerMatchHistory(page, {
      puuids: player.puuids,
      ...(filters.games === "all" ? {} : { limit: filters.games }),
      ...queueFilters,
    });
    const poolRows = await readPlayerChampionPool(page, {
      puuids: player.puuids,
      games: filters.championGames ?? filters.games,
      ...queueFilters,
    });
    const context = await readHistoryLakeContext(page, recentRows);
    const behavior = await buildPlayerBehavior(page, {
      puuids: player.puuids,
      recentRows,
      roleShare: calculatePreferredPositions(recentRows),
      ...queueFilters,
    });
    if (community === undefined) {
      return {
        recentRows,
        poolRows,
        context,
        behavior,
        championFormRows: [],
        sharedRows: [],
      };
    }
    const championFormRows = await readChampionRecentForm(page, {
      puuids: player.puuids,
      championIds: poolRows
        .slice(0, CHAMPION_FORM_CHAMPIONS)
        .map((row) => row.champion_id),
      perChampion: CHAMPION_FORM_GAMES,
      ...(filters.queues === undefined ? {} : { queues: filters.queues }),
    });
    const sharedRows = await readGuildMatchRows(page, {
      puuids: player.puuids,
      queues: STANDARD_COMMUNITY_QUEUES,
      afterMs: Date.now() - PLAYS_WITH_WINDOW_DAYS * DAY_MS,
    });
    return {
      recentRows,
      poolRows,
      context,
      behavior,
      championFormRows,
      sharedRows,
    };
  });
}

async function profileSummaryForPlayer(
  player: ResolvedPlayerProfile,
  filters: ProfileFilters,
  community?: CommunityScope,
) {
  const accounts = await accountSummaries(player.accounts);
  if (player.puuids.length === 0) {
    return {
      summary: {
        alias: player.alias,
        accountCount: 0,
        accounts,
        riotIds: [],
        ranks: { solo: undefined, flex: undefined },
        recentForm: null,
        behavior: null,
        championPool: [],
        minGamesForRate: MIN_GAMES_FOR_RATE,
      },
      extras: {
        highlights: buildHighlights({ recent: [], streak: null, pool: [] }),
        championForm: [],
        playsWith: { windowDays: PLAYS_WITH_WINDOW_DAYS, friends: [] },
      },
    };
  }

  const [ranks, lake] = await Promise.all([
    latestRanks(player.puuids),
    readProfileLake(player, filters, community),
  ]);
  const recent = await decorateHistoryRows(
    lake.recentRows,
    player.accounts,
    lake.context,
  );
  const championPool = championPoolEntries(lake.poolRows);
  const participations = recent
    .map((entry) => entry.killParticipation)
    .filter((value) => value !== null);
  const subject = community?.players.find(
    (candidate) => candidate.id === player.playerId,
  );

  const summary = {
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
    behavior: lake.behavior,
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
            averageCs:
              recent.reduce((sum, entry) => sum + entry.creepScore, 0) /
              recent.length,
            averageCsPerMinute:
              recent.reduce((sum, entry) => sum + entry.csPerMinute, 0) /
              recent.length,
            averageVisionScore:
              recent.reduce((sum, entry) => sum + entry.visionScore, 0) /
              recent.length,
            preferredPositions: calculatePreferredPositions(lake.recentRows),
          },
    championPool,
    minGamesForRate: MIN_GAMES_FOR_RATE,
  };
  const extras = {
    highlights: buildHighlights({
      recent,
      streak: lake.behavior.streak,
      pool: championPool,
    }),
    championForm: buildChampionForm(championPool, lake.championFormRows),
    playsWith:
      subject === undefined || community === undefined
        ? { windowDays: PLAYS_WITH_WINDOW_DAYS, friends: [] }
        : buildPlaysWith({
            subject,
            players: community.players,
            rows: lake.sharedRows,
          }),
  };
  return { summary, extras };
}

export async function getPlayerProfileSummary(
  input: z.infer<typeof PlayerProfileInput>,
) {
  const player = await resolveGuildPuuids(input);
  const { summary } = await profileSummaryForPlayer(player, {
    games: RECENT_FORM_GAMES,
    championGames: "all",
    ...(input.queue === undefined ? {} : { queue: input.queue }),
  });
  return {
    discordId: player.discordId,
    ...summary,
  };
}

/**
 * The tracked players of one server, for attributing shared games to friends.
 * Postgres only.
 */
async function communityPlayers(guildId: DiscordGuildId) {
  return await prisma.player.findMany({
    where: { serverId: guildId },
    select: {
      id: true,
      alias: true,
      accounts: {
        select: {
          id: true,
          puuid: true,
          riotGameName: true,
          riotTagLine: true,
          region: true,
        },
      },
    },
  });
}

export async function getConsumerPlayerProfileSummary(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
  queues?: QueueType[];
  games: PlayerProfileGameWindow;
}) {
  const player = await resolveConsumerPlayerPuuids(input);
  const players = await communityPlayers(player.guildId);
  const { summary, extras } = await profileSummaryForPlayer(
    player,
    {
      games: PlayerProfileGameWindowSchema.parse(input.games),
      ...(input.queues === undefined
        ? {}
        : { queues: PlayerProfileQueueSelectionSchema.parse(input.queues) }),
    },
    { players },
  );
  return { guildId: player.guildId, ...summary, ...extras };
}
