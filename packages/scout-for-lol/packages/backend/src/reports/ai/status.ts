import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import {
  ReportAiEditStatusSchema,
  type ReportAiEditStatus,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { getReportAiQuotaStatus } from "#src/reports/ai/rate-limit.ts";

export function getReportAiEditStatus(params: {
  guildId: DiscordGuildId;
  userId: DiscordAccountId;
}): ReportAiEditStatus {
  const model = configuration.reportAiModel ?? "openai/gpt-5.5";
  const featureEnabled = getFlag("ai_reports_enabled", {
    server: params.guildId,
    user: params.userId,
  });
  const hasRequiredProviderKey =
    !model.startsWith("openai/") || configuration.openaiApiKey !== undefined;
  const disabledReason = featureEnabled
    ? hasRequiredProviderKey
      ? null
      : "OPENAI_API_KEY is not configured."
    : "AI report editing is not enabled for this server.";
  const quota = getReportAiQuotaStatus(params);

  return ReportAiEditStatusSchema.parse({
    enabled: featureEnabled && hasRequiredProviderKey,
    disabledReason,
    model,
    quota: quota.quota,
    activeRun: quota.activeRun,
  });
}
