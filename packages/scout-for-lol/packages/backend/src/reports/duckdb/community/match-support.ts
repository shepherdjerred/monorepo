import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";

const MatchSupportRowSchema = z.object({
  match_id: z.string(),
  queue_id: z.number(),
  game_mode: z.string(),
});

export async function fetchMatchSupport(matchIds: string[]) {
  if (matchIds.length === 0) return [];
  const files = await resolveLakeFiles(resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
  if (source === undefined) return [];
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT DISTINCT match_id, queue_id, game_mode FROM (${source.sql})`,
      bindParams(session, source.params),
    );
    return rows.map((row) => MatchSupportRowSchema.parse(row));
  });
}
