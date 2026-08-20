import type {
  ReportFilter,
  ReportQueryPlan,
} from "#src/model/report-query-spec.ts";

export function validateSourceFilters(
  source: ReportQueryPlan["source"],
  filters: ReportFilter[],
): void {
  const prematchFields = new Set([
    "player",
    "champion_id",
    "queue",
    "game_mode",
    "game_type",
    "map_id",
  ]);
  for (const filter of filters) {
    const valid =
      source === "rank_current" || source === "competition_rank"
        ? false
        : source !== "prematch_participants" ||
          prematchFields.has(filter.field);
    if (!valid) {
      throw new Error(`Filter ${filter.field} is not available for ${source}.`);
    }
  }
}

export function validateSourcePlayerRefs(
  source: ReportQueryPlan["source"],
  playerRefs: string[],
): void {
  if (playerRefs.length === 0) return;
  if (source === "match_participants") return;
  throw new Error(`player('…') is not available for ${source}.`);
}

export function validateSourceWindow(
  source: ReportQueryPlan["source"],
  window: ReportQueryPlan["window"],
): void {
  if (
    (source === "rank_current" || source === "competition_rank") &&
    window.kind !== "all_time"
  ) {
    throw new Error(`${source} supports DURING ALL TIME only.`);
  }
}
