import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  buildMatchesSource,
  listParam,
  withLakeQueryRetry,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/** Callers authorize and bound the match IDs before reading their lake rows. */
export function buildMatchIdsSource(
  files: LakeFiles,
  matchIds: RiotMatchId[],
): SqlFragment | undefined {
  if (matchIds.length === 0) return undefined;
  return buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
}

export async function withMatchIdsSource<T>(
  matchIds: RiotMatchId[],
  lakeDir: string | undefined,
  query: (source: SqlFragment | undefined) => Promise<T>,
): Promise<T> {
  return matchIds.length === 0
    ? await query(undefined)
    : await withLakeQueryRetry(
        lakeDir ?? resolveLakeDir(),
        async (files) => await query(buildMatchIdsSource(files, matchIds)),
      );
}
