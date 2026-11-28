import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import {
  isArenaQueueOrMode,
  QueueTypeSchema,
  leaguePointsDelta,
  type DiscordGuildId,
  type MatchLoadout,
  type PlayerId,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { matchLoadoutFromLakeRow } from "#src/report-lake/loadout.ts";
import { arenaAugmentsFromLakeRow } from "#src/report-lake/arena.ts";
import { PlayerLookupInput } from "#src/lib/player-admin/shared.ts";
import {
  parseRank,
  resolveConsumerPlayerPuuids,
  resolveGuildPuuids,
  type ProfileAccount,
  type ResolvedPlayerProfile,
} from "#src/lib/player-profile/profile-resolution.ts";
import {
  fetchPlayerMatchHistory,
  readTeamTotalsForMatches,
  type LakePlayerMatchHistoryRow,
  type MatchHistoryCursor,
} from "#src/reports/duckdb/lake-reads.ts";
import {
  withLakePage,
  type LakePage,
} from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { readHistoryRosters } from "#src/reports/duckdb/community/history-roster.ts";

/**
 * Read models for the player profile surface.
 *
 * Authorization note: `resolveGuildPuuids` is the only way into the lake here.
 * The matches parquet carries no `server_id`, so the puuid list these queries
 * pass down IS the guild boundary — it comes from `getPlayerOrThrow`, which
 * looks a player up by the `(serverId, alias)` unique and returns only that
 * server's accounts. Never source puuids any other way.
 */

/** Games summarised for "recent form"; also the default history page size. */
const RECENT_FORM_GAMES = 20;

const MatchHistoryCursorSchema = z.object({
  gameCreationMs: z.number().int(),
  matchId: RiotMatchIdSchema,
  consumed: z.number().int().nonnegative().optional(),
});

export const PlayerProfileInput = PlayerLookupInput.extend({
  queue: QueueTypeSchema.optional(),
});

export const PlayerMatchHistoryInput = PlayerLookupInput.extend({
  limit: z.number().int().min(1).max(50).default(RECENT_FORM_GAMES),
  cursor: MatchHistoryCursorSchema.optional(),
  queue: QueueTypeSchema.optional(),
});

export type MatchHistoryEntry = {
  matchId: RiotMatchId;
  gameCreationMs: number;
  gameDurationSeconds: number;
  queue: string | null;
  queueId: number;
  gameMode: string;
  placement: number | null;
  augments: { id: number; name: string }[];
  roster: {
    teamId: number;
    championName: string;
    riotId: { gameName: string | null; tagLine: string };
  }[];
  championId: number;
  championName: string;
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  /** Riot's `largestMultiKill`: 2 double, 3 triple, 4 quadra, 5 penta. */
  largestMultiKill: number;
  csPerMinute: number;
  visionScore: number;
  goldEarned: number;
  /** Null when the team's totals are absent — never silently 0. */
  killParticipation: number | null;
  damageShare: number | null;
  /** LP change for this game; null unless both before and after are known. */
  leaguePointsDelta: number | null;
  loadout: MatchLoadout;
  account: {
    gameName: string | null;
    tagLine: string | null;
    region: string;
  };
};

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export type HistoryLakeContext = {
  teamTotals: Awaited<ReturnType<typeof readTeamTotalsForMatches>>;
  rosterRows: Awaited<ReturnType<typeof readHistoryRosters>>;
};

/**
 * The lake half of decorating history rows: team totals and rosters are
 * match-scoped, so they cannot come from the puuid-filtered rows themselves.
 * Runs on the caller's lake page.
 */
export async function readHistoryLakeContext(
  page: LakePage,
  rows: { match_id: RiotMatchId }[],
): Promise<HistoryLakeContext> {
  const matchIds = rows.map((row) => row.match_id);
  const teamTotals = await readTeamTotalsForMatches(page, { matchIds });
  const rosterRows = await readHistoryRosters(page, { matchIds });
  return { teamTotals, rosterRows };
}

/**
 * Attach team-relative and rank-relative context to raw lake rows.
 *
 * Without a `context` it reads the team totals and rosters itself, on one lake
 * slot; a page that already holds a slot passes the context it read there.
 */
export async function decorateHistoryRows(
  rows: LakePlayerMatchHistoryRow[],
  accounts: ProfileAccount[],
  context?: HistoryLakeContext,
): Promise<MatchHistoryEntry[]> {
  if (rows.length === 0) return [];
  const matchIds = rows.map((row) => row.match_id);
  const puuids = accounts.map((account) => account.puuid);

  const [{ teamTotals, rosterRows }, rankRows] = await Promise.all([
    context === undefined
      ? withLakePage(
          undefined,
          async (page) => await readHistoryLakeContext(page, rows),
        )
      : Promise.resolve(context),
    prisma.matchRankHistory.findMany({
      where: { matchId: { in: matchIds }, puuid: { in: puuids } },
    }),
  ]);

  const rostersByMatch = new Map<string, typeof rosterRows>();
  for (const roster of rosterRows) {
    const entries = rostersByMatch.get(roster.match_id) ?? [];
    entries.push(roster);
    rostersByMatch.set(roster.match_id, entries);
  }

  const totalsByKey = new Map(
    teamTotals.map((total) => [
      `${total.match_id}:${total.team_id.toString()}`,
      total,
    ]),
  );
  const rankByMatchAndPuuid = new Map(
    rankRows.map((row) => [`${row.matchId}:${row.puuid}`, row]),
  );
  const accountByPuuid = new Map<string, (typeof accounts)[number]>(
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
      queueId: row.queue_id,
      gameMode: row.game_mode,
      placement: isArenaQueueOrMode(row.queue_id, row.game_mode)
        ? (row.subteam_placement ?? row.placement)
        : null,
      augments: arenaAugmentsFromLakeRow(row),
      roster: (rostersByMatch.get(row.match_id) ?? []).map((participant) => ({
        teamId: participant.team_id,
        championName: participant.champion_name,
        riotId: {
          gameName: participant.riot_id_game_name,
          tagLine: participant.riot_id_tagline,
        },
      })),
      championId: row.champion_id,
      championName: row.champion_name,
      teamPosition: row.team_position,
      win: row.win,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      creepScore: row.creep_score,
      largestMultiKill: row.largest_multi_kill,
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
      loadout: matchLoadoutFromLakeRow(row),
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
    queues?: QueueType[];
    championSearch?: string;
    games?: PlayerProfileGameWindow;
  },
): Promise<{
  entries: MatchHistoryEntry[];
  nextCursor: MatchHistoryCursor | null;
}> {
  if (player.puuids.length === 0) {
    return { entries: [], nextCursor: null };
  }

  const consumed = input.cursor?.consumed ?? 0;
  const remaining =
    input.games === 20 || input.games === 50
      ? Math.max(0, input.games - consumed)
      : input.limit;
  if (remaining === 0) {
    return { entries: [], nextCursor: null };
  }
  const pageLimit = Math.min(input.limit, remaining);
  const rows = await fetchPlayerMatchHistory({
    puuids: player.puuids,
    limit: pageLimit + 1,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.queue === undefined ? {} : { queue: input.queue }),
    ...(input.queues === undefined ? {} : { queues: input.queues }),
    ...(input.championSearch === undefined
      ? {}
      : { championSearch: input.championSearch }),
  });
  const page = rows.slice(0, pageLimit);
  const last =
    rows.length > pageLimit &&
    (input.games === "all" ||
      input.games === undefined ||
      page.length < remaining)
      ? page.at(-1)
      : undefined;

  return {
    entries: await decorateHistoryRows(page, player.accounts),
    nextCursor:
      last === undefined
        ? null
        : {
            gameCreationMs: last.game_creation_ms,
            matchId: last.match_id,
            consumed: consumed + page.length,
          },
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
    games: "all",
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.queue === undefined ? {} : { queue: input.queue }),
  });
}

export async function getConsumerPlayerMatchHistory(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
  limit: number;
  cursor?: MatchHistoryCursor;
  queues?: QueueType[];
  games: PlayerProfileGameWindow;
  championSearch?: string;
}) {
  const player = await resolveConsumerPlayerPuuids(input);
  return matchHistoryForPlayer(player, input);
}
