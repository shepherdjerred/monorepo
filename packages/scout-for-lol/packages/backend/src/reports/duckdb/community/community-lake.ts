import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withLakePage,
  type LakePage,
} from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import {
  buildMatchesSource,
  listParam,
  withLakeQueryRetry,
  scalarParam,
  type BoundParam,
  GAME_CREATED_MS_SQL,
  PLAYED_SECONDS_SQL,
} from "#src/reports/duckdb/lake.ts";

const LakeInt = z.union([z.number(), z.bigint()]).transform(Number);
const GuildMatchRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  game_creation_ms: LakeInt,
  queue: z.string().nullable(),
  queue_id: LakeInt,
  game_mode: z.string(),
  map_id: LakeInt,
  // NULL for a bot or an unresolved player.
  puuid: z.string().nullable(),
  team_id: LakeInt,
  player_subteam_id: LakeInt.nullable(),
  // NULL for an end-of-game record, which numbers no participant.
  participant_id: LakeInt.nullable(),
  riot_id_game_name: z.string().nullable(),
  riot_id_tagline: z.string(),
  champion_name: z.string(),
  team_position: z.string(),
  win: z.boolean(),
  kills: LakeInt,
  deaths: LakeInt,
  assists: LakeInt,
  creep_score: LakeInt,
  time_played: LakeInt,
});

export type GuildMatchRow = z.infer<typeof GuildMatchRowSchema>;

const AccountCountSchema = z.object({
  puuid: LeaguePuuidSchema,
  games: LakeInt,
  last_match_ms: LakeInt,
});

export async function fetchGuildAccountCounts(options: {
  puuids: string[];
  lakeDir?: string;
}) {
  if (options.puuids.length === 0) return [];
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const source = buildMatchesSource(files, {
        sql: "puuid IN (SELECT unnest(?))",
        params: [listParam(options.puuids)],
      });
      if (source === undefined) return [];
      return await runSource({
        source,
        sql:
          `SELECT puuid, count(DISTINCT match_id)::BIGINT AS games, max(${GAME_CREATED_MS_SQL})::BIGINT AS last_match_ms ` +
          `FROM (${source.sql}) GROUP BY puuid`,
        schema: AccountCountSchema,
      });
    },
  );
}

type GuildMatchRowOptions = {
  puuids: string[];
  queues?: string[];
  afterMs?: number;
  /**
   * Only games both lists have a participant in. `puuids` must hold both
   * lists; each side is one person's accounts.
   */
  bothOf?: { left: string[]; right: string[] };
  lakeDir?: string;
};

/**
 * Full public rosters only for games reached through the authorized guild
 * PUUIDs. The lake has no guild field; this PUUID predicate is the boundary.
 *
 * Runs on the caller's lake page.
 */
export async function readGuildMatchRows(
  page: LakePage,
  options: GuildMatchRowOptions,
): Promise<GuildMatchRow[]> {
  if (options.puuids.length === 0) return [];
  const clauses = ["puuid IN (SELECT unnest(?))"];
  const params: BoundParam[] = [listParam(options.puuids)];
  if (options.queues !== undefined) {
    clauses.push("queue IN (SELECT unnest(?))");
    params.push(listParam(options.queues));
  }
  if (options.afterMs !== undefined) {
    clauses.push(`${GAME_CREATED_MS_SQL} >= ?`);
    params.push(scalarParam(options.afterMs));
  }
  const target = buildMatchesSource(page.files, {
    sql: clauses.join(" AND "),
    params,
  });
  const full = buildMatchesSource(page.files, {
    sql: "match_id IN (SELECT match_id FROM target)",
    params: [],
  });
  if (target === undefined || full === undefined) return [];
  const both = options.bothOf;
  const sql =
    `WITH target AS (SELECT match_id FROM (${target.sql}) GROUP BY match_id` +
    (both === undefined
      ? ""
      : ` HAVING bool_or(puuid IN (SELECT unnest(?))) AND bool_or(puuid IN (SELECT unnest(?)))`) +
    `), ` +
    `full_rosters AS (${full.sql}) ` +
    `SELECT match_id, ${GAME_CREATED_MS_SQL}::BIGINT AS game_creation_ms, ` +
    `queue, queue_id, game_mode, map_id, puuid, team_id, player_subteam_id, participant_id, ` +
    `riot_id_game_name, riot_id_tagline, champion_name, team_position, win, ` +
    `kills, deaths, assists, creep_score, ${PLAYED_SECONDS_SQL} AS time_played FROM full_rosters ` +
    `ORDER BY game_creation_ms DESC, match_id DESC, participant_id, team_id, champion_name`;
  return await runSource({
    session: page.session,
    source: target,
    trailingParams:
      both === undefined
        ? full.params
        : [listParam(both.left), listParam(both.right), ...full.params],
    sql,
    schema: GuildMatchRowSchema,
  });
}

export async function fetchGuildMatchRows(
  options: GuildMatchRowOptions,
): Promise<GuildMatchRow[]> {
  return options.puuids.length === 0
    ? []
    : await withLakePage(
        options.lakeDir,
        async (page) => await readGuildMatchRows(page, options),
      );
}
