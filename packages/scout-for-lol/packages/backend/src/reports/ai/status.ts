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
  const model = configuration.reportAiModel ?? "gpt-5.6-sol";
  const featureEnabled = getFlag("ai_reports_enabled", {
    server: params.guildId,
    user: params.userId,
  });
  const exempt = getFlag("ai_reports_unlimited", {
    server: params.guildId,
    user: params.userId,
  });
  const hasRequiredProviderKey = configuration.openRouterApiKey !== undefined;
  const disabledReason = featureEnabled
    ? hasRequiredProviderKey
      ? null
      : "OPENROUTER_API_KEY is not configured."
    : "AI report editing is not enabled for this server.";
  const quota = getReportAiQuotaStatus(params, Date.now(), { exempt });

  return ReportAiEditStatusSchema.parse({
    enabled: featureEnabled && hasRequiredProviderKey,
    disabledReason,
    model,
    exempt,
    quota: quota.quota,
    activeRun: quota.activeRun,
  });
}
