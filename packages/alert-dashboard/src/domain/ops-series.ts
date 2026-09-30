import type {
  SeriesPresetId,
  SeriesRange,
  SeriesUnit,
} from "#shared/ops-schema";

/**
 * Named PromQL presets. The browser picks a preset id and a range; it never
 * sends PromQL. `{window}` is replaced with the range's step (at least 5m) so
 * `increase`/`rate` buckets line up with the plotted points.
 */
export type SeriesPreset = {
  title: string;
  unit: SeriesUnit;
  queries: readonly {
    promql: string;
    /** Label whose value names each series; absent means one fixed name. */
    legendLabel?: string;
    /** Name when the query has no legend label, or the label is missing. */
    name: string;
  }[];
};

// Live catalog-priced spend; the providers' own figure is the billed preset.
const LIVE_LLM_COST =
  'sum by (service, workload, model) (increase(llm_cost_usd_total{type="catalog"}[{window}]))';

export const SERIES_PRESETS: Record<SeriesPresetId, SeriesPreset> = {
  "ai-cost-by-source": {
    title: "AI cost by source",
    unit: "usd",
    queries: [
      {
        promql: "sum by (source) (increase(ai_usage_cost_usd_total[{window}]))",
        legendLabel: "source",
        name: "cost",
      },
    ],
  },
  "ai-tokens-by-tool": {
    title: "AI tokens by tool",
    unit: "tokens",
    queries: [
      {
        promql: "sum by (source) (increase(ai_usage_tokens_total[{window}]))",
        legendLabel: "source",
        name: "tokens",
      },
    ],
  },
  "ai-quota": {
    title: "Subscription quota used",
    unit: "ratio",
    queries: [
      {
        promql:
          'label_join(max by (provider, window_kind) (ai_subscription_quota_used_ratio), "series", " ", "provider", "window_kind")',
        legendLabel: "series",
        name: "quota",
      },
    ],
  },
  "cluster-llm-cost": {
    title: "Cluster LLM cost by service",
    unit: "usd",
    queries: [
      {
        promql: `sum by (service) (${LIVE_LLM_COST})`,
        legendLabel: "service",
        name: "llm",
      },
    ],
  },
  "provider-billed-cost": {
    title: "Provider-billed LLM cost today",
    unit: "usd",
    queries: [
      {
        promql: 'sum by (provider) (llm_billed_cost_usd{window="today"})',
        legendLabel: "provider",
        name: "billed",
      },
    ],
  },
  "prs-open": {
    title: "Open pull requests",
    unit: "count",
    queries: [
      {
        promql: "sum by (author_class) (github_pull_requests_open)",
        legendLabel: "author_class",
        name: "open",
      },
    ],
  },
  "prs-merged": {
    title: "Pull requests merged (7d)",
    unit: "count",
    queries: [
      { promql: "max(github_pull_requests_merged_7d)", name: "merged 7d" },
    ],
  },
  "renovate-pending": {
    title: "Renovate updates pending",
    unit: "count",
    queries: [
      {
        promql: "sum by (state) (renovate_updates_pending)",
        legendLabel: "state",
        name: "pending",
      },
    ],
  },
  "bugsink-unresolved": {
    title: "Unresolved Bugsink issues",
    unit: "count",
    queries: [{ promql: "sum(bugsink_issues_unresolved)", name: "unresolved" }],
  },
  "linear-open": {
    title: "Open Linear issues",
    unit: "count",
    queries: [
      {
        promql: "sum by (state_type) (linear_issues_open)",
        legendLabel: "state_type",
        name: "open",
      },
    ],
  },
  "alerts-firing": {
    title: "Firing alerts",
    unit: "count",
    queries: [
      {
        promql: 'sum by (severity) (ALERTS{alertstate="firing"})',
        legendLabel: "severity",
        name: "firing",
      },
    ],
  },
  "node-cpu": {
    title: "Node CPU used",
    unit: "ratio",
    queries: [
      {
        promql:
          '1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[{window}]))',
        legendLabel: "instance",
        name: "cpu",
      },
    ],
  },
  "node-memory": {
    title: "Node memory used",
    unit: "ratio",
    queries: [
      {
        promql:
          "1 - sum by (instance) (node_memory_MemAvailable_bytes) / sum by (instance) (node_memory_MemTotal_bytes)",
        legendLabel: "instance",
        name: "memory",
      },
    ],
  },
};

/** Range length and plotted step; every range yields at most ~300 points. */
export const SERIES_RANGE_SECONDS: Record<
  SeriesRange,
  { durationSeconds: number; stepSeconds: number }
> = {
  "24h": { durationSeconds: 24 * 3600, stepSeconds: 300 },
  "7d": { durationSeconds: 7 * 24 * 3600, stepSeconds: 3600 },
  "30d": { durationSeconds: 30 * 24 * 3600, stepSeconds: 4 * 3600 },
  "90d": { durationSeconds: 90 * 24 * 3600, stepSeconds: 12 * 3600 },
};

const MIN_WINDOW_SECONDS = 300;

export type PlannedRangeQuery = {
  promql: string;
  legendLabel?: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  stepSeconds: number;
};

/**
 * Expand a preset into concrete range queries. Start and end snap to the step
 * grid so every query in a preset returns points on the same timestamps.
 */
export function planSeries(
  preset: SeriesPresetId,
  range: SeriesRange,
  nowSeconds: number,
): PlannedRangeQuery[] {
  const { durationSeconds, stepSeconds } = SERIES_RANGE_SECONDS[range];
  const endSeconds = Math.floor(nowSeconds / stepSeconds) * stepSeconds;
  const startSeconds = endSeconds - durationSeconds;
  const window = `${String(Math.max(stepSeconds, MIN_WINDOW_SECONDS))}s`;
  return SERIES_PRESETS[preset].queries.map((query) => ({
    ...query,
    promql: query.promql.replaceAll("{window}", window),
    startSeconds,
    endSeconds,
    stepSeconds,
  }));
}

/** Instant queries the weekly review compares against the prior week. */
export const REVIEW_QUERIES = {
  aiSpend7d: "sum(increase(ai_usage_cost_usd_total[7d]))",
  aiSpendPrevious7d: "sum(increase(ai_usage_cost_usd_total[7d] offset 7d))",
  llmSpend7d: `sum(${LIVE_LLM_COST.replaceAll("[{window}]", "[7d]")})`,
  llmSpendPrevious7d: `sum(${LIVE_LLM_COST.replaceAll("[{window}]", "[7d] offset 7d")})`,
} as const;
