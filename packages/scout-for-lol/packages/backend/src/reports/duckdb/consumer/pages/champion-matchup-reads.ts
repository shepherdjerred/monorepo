import { z } from "zod";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  type Lane,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  entryAccountPairs,
  entryGamesSource,
  gameWindow,
  rankedEntryGames,
  type ChampionPageEntry,
} from "#src/reports/duckdb/consumer/pages/ranked-entry-games.ts";
import {
  TIMELINE_CHECKPOINT_WINDOW_MS,
  type LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  buildMatchesSource,
  buildTimelineParticipantFramesSource,
  listParam,
  scalarParam,
  GAME_CREATED_MS_SQL,
} from "#src/reports/duckdb/lake.ts";
import type { RoleMatchupRow } from "#src/reports/lanes/role-matchups.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

/** The position string Riot stores for each lane. */
const RIOT_POSITION_BY_LANE = {
  top: "TOP",
  jungle: "JUNGLE",
  middle: "MIDDLE",
  adc: "BOTTOM",
  support: "UTILITY",
} as const satisfies Record<Lane, string>;

const MatchupGameSchema = z.object({
  entry_key: z.string(),
  match_id: RiotMatchIdSchema,
  team_id: LakeIntSchema,
  win: z.boolean(),
  played_at_ms: LakeIntSchema,
});

const MatchupParticipantSchema = z.object({
  match_id: RiotMatchIdSchema,
  queue: z.string().nullable(),
  queue_id: LakeIntSchema,
  game_mode: z.string(),
  game_type: z.string(),
  map_id: LakeIntSchema,
  participant_id: LakeIntSchema.nullable(),
  team_id: LakeIntSchema,
  team_position: z.string(),
  champion_id: LakeIntSchema,
  champion_name: z.string(),
});

const MatchupFrameSchema = z.object({
  match_id: RiotMatchIdSchema,
  participant_id: LakeIntSchema,
  frame_timestamp_ms: LakeIntSchema,
  total_gold: LakeIntSchema,
  minions_killed: LakeIntSchema,
  jungle_minions_killed: LakeIntSchema,
  xp: LakeIntSchema,
});

export type LakeMatchupGame = {
  entryKey: string;
  matchId: RiotMatchId;
  teamId: number;
  win: boolean;
  playedAtMs: number;
};

export type LakeMatchupParticipant = RoleMatchupRow & {
  match_id: RiotMatchId;
  champion_id: number;
  champion_name: string;
};

export type LakeMatchupFrame = LaneDeltaFrame & { match_id: RiotMatchId };

export type ChampionMatchupInputs = {
  /** Each entry's games on the champion in the lane, newest first within the window. */
  games: LakeMatchupGame[];
  /** Every participant of those games. */
  participants: LakeMatchupParticipant[];
  /** The frames at the 15:00 checkpoint; a game with none carries no lane result. */
  frames: LakeMatchupFrame[];
};

/**
 * What a champion's matchups are worked out from, in one page session: the
 * entries' games on the champion in the lane, the ten participants of each,
 * and the checkpoint frames of those that have a timeline. The lane result is
 * derived from these exactly as `buildRoleMatchups` does for a match page; the
 * planned `lane_results` table will replace the frame read.
 */
export async function fetchChampionMatchupInputs(options: {
  championId: number;
  lane: Lane;
  entries: ChampionPageEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[] | undefined;
  checkpointMs: number;
  lakeDir?: string | undefined;
}): Promise<ChampionMatchupInputs> {
  const pairs = entryAccountPairs(options.entries);
  const empty: ChampionMatchupInputs = {
    games: [],
    participants: [],
    frames: [],
  };
  if (pairs.length === 0) return empty;
  return await withLakePage(options.lakeDir, async (page) => {
    const gamesSource = entryGamesSource(page.files, {
      pairs,
      queues: options.queues,
      extra: {
        sql: "champion_id = ? AND team_position = ?",
        params: [
          scalarParam(options.championId),
          scalarParam(RIOT_POSITION_BY_LANE[options.lane]),
        ],
      },
    });
    if (gamesSource === undefined) return empty;
    const ranked = rankedEntryGames(gamesSource, pairs);
    const window = gameWindow(options.games);
    const games = await runSource({
      session: page.session,
      source: gamesSource,
      leadingParams: ranked.leadingParams,
      trailingParams: window.params,
      sql:
        `${ranked.sql} ` +
        `SELECT entry_key, match_id, team_id, win, ${GAME_CREATED_MS_SQL}::BIGINT AS played_at_ms ` +
        `FROM ranked ${window.where} ORDER BY entry_key, player_game_rank`,
      schema: MatchupGameSchema,
    });
    if (games.length === 0) return empty;
    const matchIds = [...new Set(games.map((game) => game.match_id))];
    const participantsSource = buildMatchesSource(page.files, {
      sql: "match_id IN (SELECT unnest(?))",
      params: [listParam(matchIds)],
    });
    const participants =
      participantsSource === undefined
        ? []
        : await runSource({
            session: page.session,
            source: participantsSource,
            sql:
              `SELECT match_id, queue, queue_id, game_mode, game_type, map_id, participant_id, ` +
              `team_id, team_position, champion_id, champion_name FROM (${participantsSource.sql}) ` +
              `ORDER BY match_id, team_id, participant_id`,
            schema: MatchupParticipantSchema,
          });
    const framesSource = buildTimelineParticipantFramesSource(page.files, {
      sql: "match_id IN (SELECT unnest(?)) AND frame_timestamp_ms >= ? AND frame_timestamp_ms < ?",
      params: [
        listParam(matchIds),
        scalarParam(options.checkpointMs),
        scalarParam(options.checkpointMs + TIMELINE_CHECKPOINT_WINDOW_MS),
      ],
    });
    const frames =
      framesSource === undefined
        ? []
        : await runSource({
            session: page.session,
            source: framesSource,
            sql:
              `SELECT match_id, participant_id, frame_timestamp_ms, total_gold, minions_killed, ` +
              `jungle_minions_killed, xp FROM (${framesSource.sql}) ` +
              `QUALIFY frame_timestamp_ms = min(frame_timestamp_ms) OVER (PARTITION BY match_id) ` +
              `ORDER BY match_id, participant_id`,
            schema: MatchupFrameSchema,
          });
    return {
      games: games.map((game) => ({
        entryKey: game.entry_key,
        matchId: game.match_id,
        teamId: game.team_id,
        win: game.win,
        playedAtMs: game.played_at_ms,
      })),
      participants,
      frames,
    };
  });
}
