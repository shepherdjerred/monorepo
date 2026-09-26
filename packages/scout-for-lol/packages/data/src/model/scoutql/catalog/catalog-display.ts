import type { ReportDisplayKind } from "#src/model/reports/report.ts";
import type { ScoutQlColumnType } from "#src/model/scoutql/catalog/catalog-column-types.ts";

/** Raw columns that hold seconds and display as durations. */
const DURATION_COLUMNS = new Set([
  "game_duration_seconds",
  "time_played",
  "total_time_spent_dead",
  "longest_time_spent_living",
  "time_ccing_others",
]);

export function rawDisplayKind(
  name: string,
  type: ScoutQlColumnType,
): ReportDisplayKind {
  if (DURATION_COLUMNS.has(name)) return "duration";
  if (name === "kda") return "ratio";
  switch (type) {
    case "timestamp":
      return "timestamp";
    case "varchar":
    case "boolean":
      return "text";
    case "double":
      return "decimal";
    case "integer":
    case "bigint":
      return "count";
  }
}
