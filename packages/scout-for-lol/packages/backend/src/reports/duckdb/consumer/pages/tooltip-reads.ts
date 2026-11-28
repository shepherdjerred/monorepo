import { z } from "zod";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import {
  entryAccountPairs,
  entryGamesSource,
  rankedEntryGames,
  type ChampionPageEntry,
} from "#src/reports/duckdb/consumer/pages/ranked-entry-games.ts";
import {
  GAME_CREATED_MS_SQL,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const SharedGameRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  win: z.boolean(),
  played_at_ms: LakeIntSchema,
});

export type SharedGameRow = z.infer<typeof SharedGameRowSchema>;

/**
 * The games two people played on the same team, newest first, on the caller's
 * lake page. Each person's accounts are merged, so a game on two accounts of
 * one person counts once, and a match is one row however many of the two
 * accounts were in it.
 */
export async function readSharedGames(
  page: LakePage,
  options: {
    first: ChampionPageEntry;
    second: ChampionPageEntry;
    queues: readonly string[];
    sinceMs: number;
  },
): Promise<SharedGameRow[]> {
  const pairs = entryAccountPairs([options.first, options.second]);
  if (options.first.puuids.length === 0 || options.second.puuids.length === 0) {
    return [];
  }
  const source = entryGamesSource(page.files, {
    pairs,
    extra: {
      sql: `queue IN (SELECT unnest(?)) AND ${GAME_CREATED_MS_SQL} >= ?`,
      params: [listParam([...options.queues]), scalarParam(options.sinceMs)],
    },
  });
  if (source === undefined) return [];
  const ranked = rankedEntryGames(source, pairs);
  return await runSource({
    session: page.session,
    source,
    leadingParams: ranked.leadingParams,
    sql:
      `${ranked.sql} ` +
      `SELECT match_id, bool_or(win) AS win, max(${GAME_CREATED_MS_SQL})::BIGINT AS played_at_ms ` +
      `FROM ranked GROUP BY match_id, team_id HAVING count(DISTINCT entry_key) = 2 ` +
      `ORDER BY played_at_ms DESC, match_id DESC`,
    schema: SharedGameRowSchema,
  });
}
