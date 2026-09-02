import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import { Context } from "@temporalio/activity";
import {
  openAiProjectCostUsd,
  openAiProjectUsageTokens,
  openAiUsageReconciliationLastSuccessTimestampSeconds,
} from "#observability/metrics.ts";
import { buildOpenAiComplimentaryAlerts } from "#shared/openai-complimentary-alerts.ts";
import {
  fetchOpenAiComplimentaryUsage,
  type OpenAiComplimentaryUsageResult,
} from "#shared/openai-complimentary-usage.ts";

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for OpenAI usage reconciliation`);
  }
  return value;
}

export type OpenAiComplimentaryUsageActivities =
  typeof openAiComplimentaryUsageActivities;

export const openAiComplimentaryUsageActivities = {
  async reconcileOpenAiComplimentaryUsage(): Promise<OpenAiComplimentaryUsageResult> {
    const now = new Date();
    const result = await fetchOpenAiComplimentaryUsage({
      adminKey: requiredEnvironment("OPENAI_ADMIN_KEY"),
      projectId: requiredEnvironment("OPENAI_OPENROUTER_PROJECT_ID"),
      now,
      cancellationSignal: Context.current().cancellationSignal,
    });
    openAiProjectUsageTokens.reset();
    for (const row of result.tokenRows) {
      openAiProjectUsageTokens.set(
        {
          model: row.model,
          service_tier: row.serviceTier,
          type: row.type,
        },
        row.tokens,
      );
    }
    openAiProjectCostUsd.set(result.costUsd);
    await createAlertmanagerPoster(requiredEnvironment("ALERTMANAGER_URL"))(
      buildOpenAiComplimentaryAlerts(result, now),
    );
    openAiUsageReconciliationLastSuccessTimestampSeconds.set(
      Math.floor(now.getTime() / 1000),
    );
    return result;
  },
};
