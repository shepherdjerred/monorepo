import {
  LANE_RESULT_READ_COLUMNS_SQL,
  LaneResultReadRowSchema,
} from "#src/report-lake/lane-results/lane-result-columns.ts";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import type { LaneResultsRead } from "#src/reports/duckdb/lake/lane-results-reads.ts";
import { buildLaneResultsSource } from "#src/reports/duckdb/lake/lane-results-source.ts";

/**
 * The `lane_results` rows matching `predicate`, newest game first, read on the
 * page's own slot.
 *
 * `unavailable` when the published build predates the table (gated) or holds
 * no derived rows at all: a page states that lane data is not available yet
 * and never recomputes lane results from timelines. An available table with no
 * matching rows is a real answer, an empty list.
 */
export async function readLaneResultsOnPage(
  page: LakePage,
  predicate: SqlFragment,
): Promise<LaneResultsRead> {
  const read = buildLaneResultsSource(page.files, predicate);
  if (read.status === "unavailable" || read.source === undefined) {
    return { status: "unavailable" };
  }
  return {
    status: "available",
    rows: await runSource({
      session: page.session,
      source: read.source,
      sql: `SELECT ${LANE_RESULT_READ_COLUMNS_SQL} FROM (${read.source.sql}) ORDER BY game_created_ms DESC, match_id DESC, participant_id`,
      schema: LaneResultReadRowSchema,
    }),
  };
}
