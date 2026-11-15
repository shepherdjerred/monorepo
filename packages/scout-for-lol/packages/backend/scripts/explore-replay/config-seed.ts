import type { DynamicConfigSeed } from "#src/config/dynamic.ts";
import configuration from "#src/configuration.ts";

export function replayDynamicConfigSeed(): DynamicConfigSeed {
  return {
    exploreGuildAllowlist: configuration.exploreGuildAllowlist,
    exploreQuotaLimits: configuration.exploreQuotaLimits,
    llmHourlyTokenBudget: configuration.llmHourlyTokenBudget,
    llmDailyTokenBudget: configuration.llmDailyTokenBudget,
    exploreModel: configuration.exploreModel,
    featureTipPercent: configuration.featureTipPercent,
    featureTipCooldownHours: configuration.featureTipCooldownHours,
    reportAiModel: configuration.reportAiModel ?? "gpt-6.1-sol",
    temporalCallGraphTracing: false,
  };
}
