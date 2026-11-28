import { LANE_RESULT_LAKE_COLUMNS } from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  buildUnionSource,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/** A `lane_results` read, or why the published build cannot answer one. */
export type LaneResultsSource =
  | { status: "unavailable" }
  | { status: "available"; source: SqlFragment | undefined };

/**
 * The derived `lane_results` table, one row per laner per tracked match,
 * keeping the newest derivation of each laner.
 *
 * Gated: a published build predating the table (the migration's predecessor,
 * until its rebuild publishes) answers `unavailable`, which a reader must
 * surface as "not yet available" rather than as no lane games. An available
 * build with no rows answers `source: undefined`, like every other source.
 */
export function buildLaneResultsSource(
  files: LakeFiles,
  predicate: SqlFragment,
): LaneResultsSource {
  if (files.laneResults.status === "unavailable") {
    return { status: "unavailable" };
  }
  return {
    status: "available",
    source: buildUnionSource({
      parquetFiles: files.laneResults.parquet,
      stagingFiles: [],
      columns: LANE_RESULT_LAKE_COLUMNS,
      dedupe: "lane-results",
      predicate,
    }),
  };
}
