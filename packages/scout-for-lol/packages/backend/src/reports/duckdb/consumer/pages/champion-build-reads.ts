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
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import { RIOT_POSITION_BY_LANE } from "#src/reports/duckdb/consumer/pages/champion-matchup-reads.ts";
import {
  entryAccountPairs,
  entryGamesSource,
  gameWindow,
  rankedEntryGames,
  type ChampionPageEntry,
} from "#src/reports/duckdb/consumer/pages/ranked-entry-games.ts";
import {
  buildTimelineEventsSource,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const BuildGameSchema = z.object({
  entry_key: z.string(),
  match_id: RiotMatchIdSchema,
  // NULL for an end-of-game record, which numbers no participant.
  participant_id: LakeIntSchema.nullable(),
  win: z.boolean(),
  // The keystone rune; NULL where the mode records no runes.
  keystone: LakeIntSchema.nullable(),
});

const BuildEventSchema = z.object({
  match_id: RiotMatchIdSchema,
  participant_id: LakeIntSchema,
  event_type: z.string(),
  event_timestamp_ms: LakeIntSchema,
  item_id: LakeIntSchema.nullable(),
  before_id: LakeIntSchema.nullable(),
  after_id: LakeIntSchema.nullable(),
});

/** The item events a build is worked out from. */
const BUILD_EVENT_TYPES = ["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO"];

export type LakeBuildGame = {
  entryKey: string;
  matchId: RiotMatchId;
  participantId: number | null;
  win: boolean;
  keystone: number | null;
};

export type LakeBuildEvent = z.infer<typeof BuildEventSchema>;

export type ChampionBuildInputs = {
  /** Each entry's games on the champion, newest first within the window. */
  games: LakeBuildGame[];
  /** The purchase, sale and undo events of those games' own participants. */
  events: LakeBuildEvent[];
};

/** The key a game's events are grouped under. */
export function buildGameKey(matchId: string, participantId: number): string {
  return `${matchId}:${participantId.toString()}`;
}

/**
 * What a champion's builds are worked out from, in one page session: the
 * entries' games on the champion (with the keystone) and the item events of
 * the entry's own participant in each. Only the entries' participants are read
 * from the timeline, never the other nine players of a game.
 */
export async function fetchChampionBuildInputs(options: {
  championId: number;
  lane?: Lane | undefined;
  entries: ChampionPageEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[] | undefined;
  lakeDir?: string | undefined;
}): Promise<ChampionBuildInputs> {
  const pairs = entryAccountPairs(options.entries);
  const empty: ChampionBuildInputs = { games: [], events: [] };
  if (pairs.length === 0) return empty;
  return await withLakePage(options.lakeDir, async (page) => {
    const championParam = scalarParam(options.championId);
    const gamesSource = entryGamesSource(page.files, {
      pairs,
      queues: options.queues,
      loadout: ["perk0"],
      extra:
        options.lane === undefined
          ? { sql: "champion_id = ?", params: [championParam] }
          : {
              sql: "champion_id = ? AND team_position = ?",
              params: [
                championParam,
                scalarParam(RIOT_POSITION_BY_LANE[options.lane]),
              ],
            },
    });
    if (gamesSource === undefined) return empty;
    const ranked = rankedEntryGames(gamesSource, pairs);
    const window = gameWindow(options.games);
    const rows = await runSource({
      session: page.session,
      source: gamesSource,
      leadingParams: ranked.leadingParams,
      trailingParams: window.params,
      sql:
        `${ranked.sql} ` +
        `SELECT entry_key, match_id, participant_id, win, perk0 AS keystone ` +
        `FROM ranked ${window.where} ORDER BY entry_key, player_game_rank`,
      schema: BuildGameSchema,
    });
    const games = rows.map((row): LakeBuildGame => ({
      entryKey: row.entry_key,
      matchId: row.match_id,
      participantId: row.participant_id,
      win: row.win,
      keystone: row.keystone === 0 ? null : row.keystone,
    }));
    const keys = games.flatMap((game) =>
      game.participantId === null
        ? []
        : [buildGameKey(game.matchId, game.participantId)],
    );
    if (keys.length === 0) return { games, events: [] };
    const eventsSource = buildTimelineEventsSource(page.files, {
      sql:
        "match_id IN (SELECT unnest(?)) AND event_type IN (SELECT unnest(?)) " +
        "AND match_id || ':' || participant_id::VARCHAR IN (SELECT unnest(?))",
      params: [
        listParam([...new Set(games.map((game) => game.matchId))]),
        listParam(BUILD_EVENT_TYPES),
        listParam([...new Set(keys)]),
      ],
    });
    const events =
      eventsSource === undefined
        ? []
        : await runSource({
            session: page.session,
            source: eventsSource,
            sql:
              `SELECT match_id, participant_id, event_type, event_timestamp_ms, item_id, before_id, after_id ` +
              `FROM (${eventsSource.sql}) ` +
              `ORDER BY match_id, participant_id, event_timestamp_ms, frame_index, event_index, event_id`,
            schema: BuildEventSchema,
          });
    return { games, events };
  });
}
