import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  withLakeQueryRetry,
  scalarParam,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";

const LakeInt = z.union([z.number(), z.bigint()]).transform(Number);
const GuildMatchRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  game_creation_ms: LakeInt,
  queue: z.string().nullable(),
  queue_id: LakeInt,
  game_mode: z.string(),
  map_id: LakeInt,
  puuid: z.string(),
  team_id: LakeInt,
  player_subteam_id: LakeInt.nullable(),
  participant_id: LakeInt,
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
      return await withDuckDBConnection(async (session) => {
        const rows = await session.run(
          `SELECT puuid, count(DISTINCT match_id)::BIGINT AS games, max(epoch_ms(game_creation_at))::BIGINT AS last_match_ms ` +
            `FROM (${source.sql}) GROUP BY puuid`,
          bindParams(session, source.params),
        );
        return rows.map((row) => AccountCountSchema.parse(row));
      });
    },
  );
}

/**
 * Full public rosters only for games reached through the authorized guild
 * PUUIDs. The lake has no guild field; this PUUID predicate is the boundary.
 */
export async function fetchGuildMatchRows(options: {
  puuids: string[];
  queues?: string[];
  afterMs?: number;
  lakeDir?: string;
}): Promise<GuildMatchRow[]> {
  if (options.puuids.length === 0) return [];
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const clauses = ["puuid IN (SELECT unnest(?))"];
      const params: BoundParam[] = [listParam(options.puuids)];
      if (options.queues !== undefined) {
        clauses.push("queue IN (SELECT unnest(?))");
        params.push(listParam(options.queues));
      }
      if (options.afterMs !== undefined) {
        clauses.push("epoch_ms(game_creation_at) >= ?");
        params.push(scalarParam(options.afterMs));
      }
      const target = buildMatchesSource(files, {
        sql: clauses.join(" AND "),
        params,
      });
      const full = buildMatchesSource(files, {
        sql: "match_id IN (SELECT match_id FROM target)",
        params: [],
      });
      if (target === undefined || full === undefined) return [];
      const sql =
        `WITH target AS (SELECT DISTINCT match_id FROM (${target.sql})), ` +
        `full_rosters AS (${full.sql}) ` +
        `SELECT match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
        `queue, queue_id, game_mode, map_id, puuid, team_id, player_subteam_id, participant_id, ` +
        `riot_id_game_name, riot_id_tagline, champion_name, team_position, win, ` +
        `kills, deaths, assists, creep_score, time_played FROM full_rosters ` +
        `ORDER BY game_creation_ms DESC, match_id DESC, participant_id`;
      return await withDuckDBConnection(async (session) => {
        const rows = await session.run(
          sql,
          bindParams(session, [...target.params, ...full.params]),
        );
        return rows.map((row) => GuildMatchRowSchema.parse(row));
      });
    },
  );
}
