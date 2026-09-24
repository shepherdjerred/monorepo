import { Context } from "@temporalio/activity";
import {
  llmBilledCostUsd,
  llmBilledReconciliationLastSuccessTimestampSeconds,
  llmBilledTokens,
} from "#observability/metrics.ts";
import {
  fetchAnthropicBilling,
  fetchOpenAiBilling,
  type LlmBillingSnapshot,
} from "#shared/llm-billing.ts";

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for LLM billed-cost reconciliation`);
  }
  return value;
}

export type LlmBilledCostActivities = typeof llmBilledCostActivities;

export const llmBilledCostActivities = {
  /**
   * Export every OpenAI project's and Anthropic workspace's billed spend as
   * gauges. Alerting and the catalog-versus-billed comparison live in
   * Prometheus and Grafana, where the catalog series already is.
   *
   * Each provider is reconciled independently: one provider's cost API being
   * down must not blank the other's gauges, and each gets its own freshness
   * timestamp so a stale feed is visible per provider.
   */
  async reconcileLlmBilledCost(): Promise<LlmBillingSnapshot> {
    const now = new Date();
    const signal = Context.current().cancellationSignal;
    const [openAi, anthropic] = await Promise.all([
      fetchOpenAiBilling({
        adminKey: requiredEnvironment("OPENAI_ADMIN_KEY"),
        now,
        cancellationSignal: signal,
      }),
      fetchAnthropicBilling({
        adminKey: requiredEnvironment("ANTHROPIC_ADMIN_API_KEY"),
        now,
        cancellationSignal: signal,
      }),
    ]);

    const costs = [...openAi.costs, ...anthropic];
    llmBilledCostUsd.reset();
    for (const cost of costs) {
      const labels = { provider: cost.provider, account: cost.account };
      llmBilledCostUsd.set({ ...labels, window: "today" }, cost.todayUsd);
      llmBilledCostUsd.set(
        { ...labels, window: "7d" },
        cost.trailingSevenDaysUsd,
      );
    }
    llmBilledTokens.reset();
    for (const row of openAi.tokens) {
      llmBilledTokens.set(
        {
          provider: row.provider,
          account: row.account,
          model: row.model,
          service_tier: row.serviceTier,
          type: row.type,
        },
        row.tokens,
      );
    }
    const observed = Math.floor(now.getTime() / 1000);
    llmBilledReconciliationLastSuccessTimestampSeconds.set(
      { provider: "openai" },
      observed,
    );
    llmBilledReconciliationLastSuccessTimestampSeconds.set(
      { provider: "anthropic" },
      observed,
    );
    return { observedAt: now.toISOString(), costs, tokens: openAi.tokens };
  },
};
