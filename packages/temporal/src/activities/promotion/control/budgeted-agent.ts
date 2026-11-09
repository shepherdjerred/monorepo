import { runPromotionAgent } from "#activities/promotion/agent.ts";
import { reservePromotionAi } from "./budget.ts";

/** Failures before generation are known to cost zero; ambiguous provider usage stays unknown. */
export async function runBudgetedPromotion(
  input: Parameters<typeof runPromotionAgent>[0],
  settings: { model: string; dailySpendUsd: number },
) {
  const recordUsage = await reservePromotionAi(
    input.store,
    input.occurrenceId,
    settings,
  );
  const generation = { started: false };
  try {
    return await runPromotionAgent({
      ...input,
      recordUsage,
      generationStarting: () => {
        generation.started = true;
      },
    });
  } catch (error) {
    if (!generation.started)
      await recordUsage({
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      });
    throw error;
  }
}
