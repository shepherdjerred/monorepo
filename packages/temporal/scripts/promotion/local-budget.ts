import {
  reservePromotionAi,
  PromotionBudgetStop,
} from "#activities/promotion/control/budget.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { LocalPromotionStop } from "./local-stop.ts";

export async function reserveLocalAi(
  store: PromotionStore,
  occurrenceId: string,
  settings: { model: string; dailySpendUsd: number },
) {
  try {
    return await reservePromotionAi(store, occurrenceId, settings);
  } catch (error) {
    if (error instanceof PromotionBudgetStop)
      throw new LocalPromotionStop("budget", error.message);
    throw error;
  }
}
