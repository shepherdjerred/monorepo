import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import type { OpenAiComplimentaryUsageResult } from "#shared/openai-complimentary-usage.ts";

const ALERT_TTL_MS = 3 * 60 * 60 * 1000;

function alert(input: {
  readonly alertname: string;
  readonly firing: boolean;
  readonly summary: string;
  readonly description: string;
  readonly now: Date;
}): AlertmanagerAlert {
  return {
    labels: {
      alertname: input.alertname,
      severity: "warning",
      component: "openai-billing",
    },
    annotations: {
      summary: input.summary,
      description: input.description,
      message: input.description,
    },
    startsAt: input.now.toISOString(),
    endsAt: new Date(
      input.now.getTime() + (input.firing ? ALERT_TTL_MS : 0),
    ).toISOString(),
  };
}

export function buildOpenAiComplimentaryAlerts(
  result: OpenAiComplimentaryUsageResult,
  now: Date,
): AlertmanagerAlert[] {
  const paidTokens = result.defaultTierTokens > 0;
  const charged = result.costUsd >= 0.01;
  return [
    alert({
      alertname: "OpenAiComplimentaryPaidTokens",
      firing: paidTokens,
      summary: paidTokens
        ? "OpenAI project used default-tier tokens"
        : "OpenAI project has no default-tier tokens",
      description: paidTokens
        ? `${String(result.defaultTierTokens)} current-day tokens were reported as default tier. A request that crosses the daily complimentary allowance is billed in full; otherwise verify OpenAI sharing eligibility and OpenRouter BYOK routing.`
        : "All current-day OpenAI project tokens are outside the paid default tier.",
      now,
    }),
    alert({
      alertname: "OpenAiOpenRouterProjectCost",
      firing: charged,
      summary: charged
        ? "Official OpenAI project cost reached the warning threshold"
        : "Official OpenAI project cost remains below the warning threshold",
      description: charged
        ? `OpenAI reports $${result.costUsd.toFixed(6)} for the monitored project today. Reconcile service-tier usage before relying on OpenRouter's estimated upstream cost.`
        : `OpenAI reports $${result.costUsd.toFixed(6)} for the monitored project today.`,
      now,
    }),
  ];
}
