import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  buildMatchesSource,
  listParam,
  withLakeQueryRetry,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/** Callers authorize and bound the match IDs before reading their lake rows. */
export async function withMatchIdsSource<T>(
  matchIds: RiotMatchId[],
  lakeDir: string | undefined,
  query: (source: SqlFragment | undefined) => Promise<T>,
): Promise<T> {
  if (matchIds.length === 0) return await query(undefined);
  return await withLakeQueryRetry(
    lakeDir ?? resolveLakeDir(),
    async (files) =>
      await query(
        buildMatchesSource(files, {
          sql: "match_id IN (SELECT unnest(?))",
          params: [listParam(matchIds)],
        }),
      ),
  );
}
