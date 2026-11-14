import type {
  PromotionOverview,
  PromotionRunSummary,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionHistoryTiming } from "@shepherdjerred/ops-model/promotion/timing.ts";

/** Keep recorded history visible while an older worker serves the additive v1 API. */
export function sourceTimingSummary(
  data: PromotionOverview,
): PromotionRunSummary {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  return {
    ...data.lastRun,
    rows: data.lastRun.rows.map((row) => {
      const source = sources.get(row.targetId);
      const timing = row.timing ?? source?.timing;
      if (timing !== undefined) return { ...row, timing };
      const history = [source?.lastAction, source?.latest].filter(
        (entry) => entry !== null && entry !== undefined,
      );
      return {
        ...row,
        timing: {
          ...promotionHistoryTiming({
            targetId: row.targetId,
            batches: data.batches,
            history,
          }),
          nextPlannedAt: null,
          nextPlannedReason:
            data.scheduling === "manual"
              ? "Manual runs only"
              : "Schedule data unavailable",
        },
      };
    }),
  };
}
