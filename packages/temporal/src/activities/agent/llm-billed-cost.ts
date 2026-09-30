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

type BillingProvider = "openai" | "anthropic";

const billedCostAccounts = new Map<BillingProvider, Set<string>>();

function publishCosts(
  provider: BillingProvider,
  costs: LlmBillingSnapshot["costs"],
): void {
  for (const account of billedCostAccounts.get(provider) ?? []) {
    llmBilledCostUsd.remove({ provider, account, window: "today" });
    llmBilledCostUsd.remove({ provider, account, window: "7d" });
  }

  const accounts = new Set<string>();
  for (const cost of costs) {
    accounts.add(cost.account);
    const labels = { provider, account: cost.account };
    llmBilledCostUsd.set({ ...labels, window: "today" }, cost.todayUsd);
    llmBilledCostUsd.set(
      { ...labels, window: "7d" },
      cost.trailingSevenDaysUsd,
    );
  }
  billedCostAccounts.set(provider, accounts);
}

function errorForProvider(provider: BillingProvider, error: unknown): Error {
  return new Error(`${provider} billing reconciliation failed`, {
    cause: error,
  });
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
    const observed = Math.floor(now.getTime() / 1000);
    const [openAiResult, anthropicResult] = await Promise.allSettled([
      Promise.resolve().then(() =>
        fetchOpenAiBilling({
          adminKey: requiredEnvironment("OPENAI_ADMIN_KEY"),
          now,
          cancellationSignal: signal,
        }),
      ),
      Promise.resolve().then(() =>
        fetchAnthropicBilling({
          adminKey: requiredEnvironment("ANTHROPIC_ADMIN_API_KEY"),
          now,
          cancellationSignal: signal,
        }),
      ),
    ]);

    const errors: Error[] = [];
    const costs: LlmBillingSnapshot["costs"][number][] = [];
    let tokens: LlmBillingSnapshot["tokens"] = [];

    if (openAiResult.status === "fulfilled") {
      const openAi = openAiResult.value;
      publishCosts("openai", openAi.costs);
      costs.push(...openAi.costs);
      tokens = openAi.tokens;
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
      llmBilledReconciliationLastSuccessTimestampSeconds.set(
        { provider: "openai" },
        observed,
      );
    } else {
      errors.push(errorForProvider("openai", openAiResult.reason));
    }

    if (anthropicResult.status === "fulfilled") {
      publishCosts("anthropic", anthropicResult.value);
      costs.push(...anthropicResult.value);
      llmBilledReconciliationLastSuccessTimestampSeconds.set(
        { provider: "anthropic" },
        observed,
      );
    } else {
      errors.push(errorForProvider("anthropic", anthropicResult.reason));
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "LLM billing reconciliation incomplete");
    }

    return { observedAt: now.toISOString(), costs, tokens };
  },
};
