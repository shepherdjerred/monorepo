import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  LANE_RESULT_READ_COLUMNS_SQL,
  LaneResultReadRowSchema,
  type LaneResultReadRow,
} from "#src/report-lake/lane-results/lane-result-columns.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { runSource } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { listParam, withLakeQueryRetry } from "#src/reports/duckdb/lake.ts";
import { buildLaneResultsSource } from "#src/reports/duckdb/lake/lane-results-source.ts";

/**
 * Lane results for a reader, or `unavailable` while the published build
 * predates the `lane_results` table. A reader shows "not yet available" for
 * that state; it is never the same as a player with no lane games.
 */
export type LaneResultsRead =
  | { status: "unavailable" }
  | { status: "available"; rows: LaneResultReadRow[] };

/** Every laner's row in the given matches, ordered by match and slot. */
export async function fetchLaneResultsForMatches(options: {
  matchIds: readonly RiotMatchId[];
  lakeDir?: string;
}): Promise<LaneResultsRead> {
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files): Promise<LaneResultsRead> => {
      const read = buildLaneResultsSource(files, {
        sql: "match_id IN (SELECT unnest(?))",
        params: [listParam([...options.matchIds])],
      });
      if (read.status === "unavailable") return read;
      if (read.source === undefined || options.matchIds.length === 0) {
        return { status: "available", rows: [] };
      }
      return {
        status: "available",
        rows: await runSource({
          source: read.source,
          sql: `SELECT ${LANE_RESULT_READ_COLUMNS_SQL} FROM (${read.source.sql}) ORDER BY match_id, participant_id`,
          schema: LaneResultReadRowSchema,
        }),
      };
    },
  );
}
