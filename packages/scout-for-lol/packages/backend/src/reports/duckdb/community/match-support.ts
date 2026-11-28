import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import {
  buildMatchIdsSource,
  withMatchIdsSource,
} from "#src/reports/duckdb/community/match-source.ts";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";

const matchSupportSql = (sourceSql: string): string =>
  `SELECT DISTINCT match_id, queue_id, game_mode FROM (${sourceSql})`;

const MatchSupportRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  queue_id: z.number(),
  game_mode: z.string(),
});

type MatchSupportRow = {
  match_id: string;
  queue_id: number;
  game_mode: string;
};

/** The same read as {@link fetchMatchSupport}, on the caller's lake page. */
export async function readMatchSupport(
  page: LakePage,
  options: { matchIds: RiotMatchId[] },
): Promise<readonly MatchSupportRow[]> {
  const source = buildMatchIdsSource(page.files, options.matchIds);
  if (source === undefined) return [];
  return await runSource({
    session: page.session,
    source,
    sql: matchSupportSql(source.sql),
    schema: MatchSupportRowSchema,
  });
}

export async function fetchMatchSupport(options: {
  matchIds: RiotMatchId[];
  abortSignal?: AbortSignal | undefined;
  lakeDir?: string | undefined;
}): Promise<readonly MatchSupportRow[]> {
  return await withMatchIdsSource(
    options.matchIds,
    options.lakeDir,
    async (source) => {
      if (source === undefined) return [];
      return await runSource({
        source,
        sql: matchSupportSql(source.sql),
        schema: MatchSupportRowSchema,
        abortSignal: options.abortSignal,
      });
    },
  );
}
