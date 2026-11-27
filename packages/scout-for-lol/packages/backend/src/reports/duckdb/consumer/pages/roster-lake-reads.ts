import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  GAME_CREATED_MS_SQL,
} from "#src/reports/duckdb/lake.ts";

const LakeInt = z.union([z.bigint(), z.number()]).transform(Number);

const RosterGameRowSchema = z.object({
  puuid: z.string(),
  match_id: RiotMatchIdSchema,
  game_creation_ms: LakeInt,
  champion_id: LakeInt,
  champion_name: z.string(),
  queue: z.string().nullable(),
  queue_id: LakeInt,
  win: z.boolean(),
  kills: LakeInt,
  deaths: LakeInt,
  assists: LakeInt,
  largest_multi_kill: LakeInt,
  game_mode: z.string(),
  team_id: LakeInt,
  player_subteam_id: LakeInt.nullable(),
});

export type RosterGameRow = z.infer<typeof RosterGameRowSchema>;

/**
 * Each account's newest `newestPerAccount` games, plus every game since
 * `sinceMs`, newest first per account. The PUUID list is the caller's whole
 * authorization surface, as for every profile read. One account can appear
 * twice in a match under two PUUIDs of the same person; the caller merges by
 * match id.
 */
export async function readRosterGames(
  page: LakePage,
  options: { puuids: string[]; newestPerAccount: number; sinceMs: number },
): Promise<RosterGameRow[]> {
  if (options.puuids.length === 0) return [];
  const source = buildMatchesSource(
    page.files,
    {
      sql: "puuid IN (SELECT unnest(?))",
      params: [listParam(options.puuids)],
    },
    [],
  );
  if (source === undefined) return [];
  return await runSource({
    session: page.session,
    source,
    trailingParams: [
      scalarParam(options.newestPerAccount),
      scalarParam(options.sinceMs),
    ],
    sql:
      `SELECT puuid, match_id, game_creation_ms, champion_id, champion_name, queue, queue_id, win, ` +
      `kills, deaths, assists, largest_multi_kill, game_mode, team_id, player_subteam_id FROM (` +
      `SELECT puuid, match_id, champion_id, champion_name, queue, queue_id, win, ` +
      `kills, deaths, assists, largest_multi_kill, game_mode, team_id, player_subteam_id, ` +
      `${GAME_CREATED_MS_SQL}::BIGINT AS game_creation_ms, ` +
      `row_number() OVER (PARTITION BY puuid ORDER BY ${GAME_CREATED_MS_SQL} DESC, match_id DESC) AS recency ` +
      `FROM (${source.sql})) ` +
      `WHERE recency <= ? OR game_creation_ms >= ? ` +
      `ORDER BY puuid, game_creation_ms DESC, match_id DESC`,
    schema: RosterGameRowSchema,
  });
}
