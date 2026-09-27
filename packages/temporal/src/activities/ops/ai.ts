import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metricsLink } from "./ops-links.ts";
import { metric, type OpsCollection } from "./ops-types.ts";

/**
 * Live cluster LLM spend, matching the `llm.ts` live-cost alert rules: the
 * catalog price applied to provider-reported tokens. Summing collapses pod
 * lifetimes, so a restart inside the window is not undercounted. It excludes
 * uninstrumented traffic and counts OpenAI complimentary tokens as paid; the
 * provider-billed gauge below is the authority for what was charged.
 */
export function clusterCostQuery(window: string): string {
  return `sum(increase(llm_cost_usd_total{type="catalog"}[${window}]))`;
}

export function aiQueries(window: string) {
  return {
    clusterMtd: clusterCostQuery(window),
    /** Current UTC-day cost the providers report billing (a daily-reset gauge). */
    billedToday: 'sum(llm_billed_cost_usd{window="today"})',
    /** Mac-side usage priced at API rates, by tool; mostly subscription use. */
    macCostMtd: `sum by (source) (increase(ai_usage_cost_usd_total[${window}]))`,
    macTokens24h: "sum(increase(ai_usage_tokens_total[24h]))",
    clusterTokens24h: "sum(increase(llm_tokens_total[24h]))",
    quotas:
      "max by (provider, window_id, window_kind) (ai_subscription_quota_used_ratio)",
    quotaResets:
      "max by (provider, window_id) (ai_subscription_quota_reset_timestamp_seconds)",
  } as const;
}

export type AiSamples = {
  clusterMtd: readonly PrometheusSample[];
  billedToday: readonly PrometheusSample[];
  macCostMtd: readonly PrometheusSample[];
  macTokens24h: readonly PrometheusSample[];
  clusterTokens24h: readonly PrometheusSample[];
  quotas: readonly PrometheusSample[];
  /** Unix seconds each quota window resets, keyed by provider and window. */
  quotaResets: readonly PrometheusSample[];
};

/** Start of the current UTC month and the share of it that has elapsed. */
export function monthProgress(now: Date): { start: Date; elapsed: number } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    start,
    elapsed:
      (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()),
  };
}

/** Prometheus range selector covering the month so far (at least a minute). */
export function monthToDateWindow(now: Date): string {
  const seconds = Math.floor(
    (now.getTime() - monthProgress(now).start.getTime()) / 1000,
  );
  return `${String(Math.max(60, seconds))}s`;
}

export function quotaSeverity(ratio: number): Severity {
  if (ratio >= OPS_POLICY.quotaErrorRatio) {
    return "error";
  }
  return ratio >= OPS_POLICY.quotaWarningRatio ? "warning" : "ok";
}

function total(samples: readonly PrometheusSample[]): number | null {
  const finite = samples.filter((sample) => Number.isFinite(sample.value));
  return finite.length === 0
    ? null
    : finite.reduce((sum, sample) => sum + sample.value, 0);
}

function quotaSignals(
  samples: readonly PrometheusSample[],
  resets: readonly PrometheusSample[],
): SignalInput[] {
  const resetSeconds = new Map(
    resets.map((reset) => [
      `${reset.metric["provider"] ?? ""}\u{0}${reset.metric["window_id"] ?? ""}`,
      reset.value,
    ]),
  );
  return samples.map((sample) => {
    const provider = sample.metric["provider"] ?? "";
    const windowId = sample.metric["window_id"] ?? "";
    if (provider === "" || windowId === "") {
      throw new Error("ai_subscription_quota_used_ratio sample lacks labels");
    }
    const kind = sample.metric["window_kind"] ?? windowId;
    const reset = resetSeconds.get(`${provider}\u{0}${windowId}`);
    return {
      id: `ai:quota:${provider}:${windowId}`,
      source: "ai",
      section: "ai",
      kind: "quota-window",
      severity: quotaSeverity(sample.value),
      needsMe: false,
      title: `${provider} ${kind}: ${String(Math.round(sample.value * 100))}% used`,
      attributes: {
        provider,
        windowId,
        windowKind: kind,
        usedRatio: sample.value,
        ...(reset === undefined || !Number.isFinite(reset)
          ? {}
          : { resetsAt: new Date(reset * 1000).toISOString() }),
      },
      links: [
        metricsLink(
          "Quota usage",
          `ai_subscription_quota_used_ratio{provider="${provider}",window_id="${windowId}"}`,
          "now-7d",
        ),
      ],
    };
  });
}

function budgetSignal(mtd: number, projected: number): SignalInput[] {
  const budget = OPS_POLICY.monthlyApiBudgetUsd;
  const overBudget = mtd > budget;
  if (
    !overBudget &&
    projected <= budget * OPS_POLICY.budgetProjectionWarningRatio
  ) {
    return [];
  }
  return [
    {
      id: "ai:budget",
      source: "ai",
      section: "ai",
      kind: "budget",
      severity: overBudget ? "error" : "warning",
      needsMe: false,
      title: overBudget
        ? `API spend $${mtd.toFixed(2)} is over the $${String(budget)} monthly budget`
        : `API spend is on track for $${projected.toFixed(0)} against a $${String(budget)} budget`,
      attributes: {
        monthToDateUsd: mtd,
        projectedUsd: projected,
        budgetUsd: budget,
      },
      links: [
        metricsLink("Cluster LLM spend", clusterCostQuery("1d"), "now-30d"),
      ],
    },
  ];
}

function providerCostSignals(samples: AiSamples): SignalInput[] {
  const signals: SignalInput[] = [];
  const billedToday = total(samples.billedToday);
  if (billedToday !== null && billedToday > 0) {
    signals.push({
      id: "ai:provider-billed-today",
      source: "ai",
      section: "ai",
      kind: "provider-cost",
      severity: "info",
      needsMe: false,
      title: `Provider-billed LLM cost today: $${billedToday.toFixed(2)}`,
      links: [
        metricsLink(
          "Provider-billed cost",
          'sum by (provider, account) (llm_billed_cost_usd{window="today"})',
          "now-7d",
        ),
      ],
    });
  }
  for (const sample of samples.macCostMtd) {
    const source = sample.metric["source"];
    if (source === undefined || !Number.isFinite(sample.value)) {
      continue;
    }
    signals.push({
      id: `ai:tool-cost:${source}`,
      source: "ai",
      section: "ai",
      kind: "tool-usage",
      severity: "ok",
      needsMe: false,
      title: `${source}: $${sample.value.toFixed(2)} API-equivalent this month`,
      attributes: { source, monthToDateUsd: sample.value },
    });
  }
  return signals;
}

export function mapAi(samples: AiSamples, now: Date): OpsCollection {
  const mtd = total(samples.clusterMtd) ?? 0;
  const { elapsed } = monthProgress(now);
  const projected = elapsed > 0 ? mtd / elapsed : mtd;
  const budget = OPS_POLICY.monthlyApiBudgetUsd;
  const overBudget = mtd > budget;
  const projectedOver =
    projected > budget * OPS_POLICY.budgetProjectionWarningRatio;
  const signals: SignalInput[] = [
    ...quotaSignals(samples.quotas, samples.quotaResets),
    ...budgetSignal(mtd, projected),
    ...providerCostSignals(samples),
  ];
  const tokens = [total(samples.macTokens24h), total(samples.clusterTokens24h)];
  const tokenTotal = tokens.every((value) => value === null)
    ? null
    : tokens.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const quotaRatios = samples.quotas.map((sample) => sample.value);
  const maxQuota = quotaRatios.length === 0 ? null : Math.max(...quotaRatios);
  return {
    signals,
    metrics: [
      metric({
        section: "ai",
        source: "ai",
        id: METRIC_IDS.aiCostMonthToDateUsd,
        label: "API spend (MTD)",
        value: mtd,
        unit: "usd",
        severity: overBudget ? "error" : "ok",
      }),
      metric({
        section: "ai",
        source: "ai",
        id: METRIC_IDS.aiCostProjectedUsd,
        label: "Projected month",
        value: projected,
        unit: "usd",
        severity: projectedOver ? "warning" : "ok",
      }),
      metric({
        section: "ai",
        source: "ai",
        id: METRIC_IDS.aiTokens24h,
        label: "Tokens (24h)",
        value: tokenTotal,
        unit: "tokens",
      }),
      metric({
        section: "ai",
        source: "ai",
        id: METRIC_IDS.aiQuotaMaxUsedRatio,
        label: "Fullest quota window",
        value: maxQuota,
        unit: "ratio",
        severity: maxQuota === null ? "ok" : quotaSeverity(maxQuota),
      }),
    ],
    changes: [],
  };
}
