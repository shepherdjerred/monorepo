import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";

/** Callers authorize and bound the match IDs before reading their lake rows. */
export async function resolveMatchIdsSource(
  matchIds: string[],
  lakeDir?: string,
) {
  if (matchIds.length === 0) return;
  const files = await resolveLakeFiles(lakeDir ?? resolveLakeDir());
  return buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
}
