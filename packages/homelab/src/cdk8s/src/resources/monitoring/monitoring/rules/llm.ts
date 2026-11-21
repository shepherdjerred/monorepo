import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Daily spend ceilings for `llm_cost_usd_total`, in USD.
 *
 * Anchored on the fleet's measured distribution, not on a guess: a 7-day mean
 * of ~$8.20/day and a worst observed rolling 24h of ~$20.80.
 * Warning sits at roughly 2x that worst real day and 5x the mean; critical at
 * roughly 3.5x the worst day and 9x the mean.
 *
 * The headroom is deliberate. These exist to catch a runaway agent loop or a
 * model-pin change -- an order-of-magnitude event -- not to police normal
 * variance, and normal variance here is already a 4x spread between a quiet day
 * and a busy one. Tightening them toward the mean would page on a busy Sunday.
 *
 * Re-derive rather than nudge these if the fleet's shape changes:
 *   max_over_time(<LIVE_COST_24H>[7d:1h])
 *
 * The same ceilings apply to the live series and to the provider-billed
 * series; they measure the same money from two directions.
 */
export const LLM_DAILY_SPEND_WARNING_USD = 40;
export const LLM_DAILY_SPEND_CRITICAL_USD = 75;

/**
 * A workload must both spike relative to its own daily rate AND clear this
 * hourly floor before it alerts. Without the floor, a workload that normally
 * costs fractions of a cent trips the ratio on any burst of ordinary traffic.
 */
export const LLM_WORKLOAD_SPIKE_RATIO = 5;
export const LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR = 0.5;

/**
 * Live LLM cost, as one expression every live cost alert is built from.
 *
 * Providers return tokens, never dollars, so the live series is always the
 * catalog price applied to provider-reported usage (`type="catalog"`). It is
 * fast -- it moves within a scrape of the request -- but it cannot see
 * complimentary data-sharing tokens or uninstrumented traffic such as Codex and
 * voice. The provider-billed series covers those, an hour late.
 *
 * The inner `sum` is load-bearing. These series carry `pod` and `instance`, so
 * a deploy inside the window leaves two counter series per workload; summing
 * collapses those lifetimes instead of keeping only one of them.
 */
function liveCost(input: {
  aggregation: "increase" | "rate";
  window: string;
}): string {
  return `sum by (service, workload, model) (${input.aggregation}(llm_cost_usd_total{type="catalog"}[${input.window}]))`;
}

/** Fleet-wide live spend over 24h, for the daily ceilings. */
const LIVE_COST_24H = `sum(${liveCost({ aggregation: "increase", window: "24h" })})`;

/** Live spend per workload, for the spike comparison. */
function liveCostByWorkload(window: string): string {
  return `sum by (service, workload) (${liveCost({ aggregation: "rate", window })})`;
}

/**
 * Provider-billed spend for the current UTC day, across every provider
 * account. This is what the providers will actually charge, net of OpenAI's
 * complimentary data-sharing tokens, so it can sit well below the live series.
 */
const BILLED_COST_TODAY = 'sum(llm_billed_cost_usd{window="today"})';

const BILLING_WORKER =
  'namespace="temporal",container="temporal-billing-worker"';
const BILLED_RECONCILIATION_STALE_SECONDS = 7200;
const BILLED_RECONCILIATION_PROVIDERS = ["openai", "anthropic"] as const;
const BILLED_RECONCILIATION_SUCCESS = `llm_billed_reconciliation_last_success_timestamp_seconds{${BILLING_WORKER}}`;
const BILLED_RECONCILIATION_MISSING_PROVIDER =
  BILLED_RECONCILIATION_PROVIDERS.map(
    (provider) =>
      `absent(llm_billed_reconciliation_last_success_timestamp_seconds{${BILLING_WORKER},provider="${provider}"})`,
  ).join(" or ");

export function getLlmRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "llm.recording",
      interval: "30s",
      rules: [
        {
          record: "llm:requests:rate5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (service, workload, provider, model, outcome) (rate(llm_requests_total[5m]))",
          ),
        },
        {
          record: "llm:cost_usd:rate5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (service, workload, provider, model, type) (rate(llm_cost_usd_total[5m]))",
          ),
        },
        {
          record: "llm:request_duration:p95_5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.95, sum by (le, service, workload, provider, model) (rate(llm_request_duration_seconds_bucket[5m])))",
          ),
        },
      ],
    },
    {
      name: "llm.alerts",
      interval: "30s",
      rules: [
        {
          alert: "LlmBilledReconciliationStale",
          // Gated on worker uptime so a fresh pod, whose gauges start empty,
          // has two hourly runs to succeed before this fires. `absent` covers a
          // provider that has never succeeded; check each expected provider
          // independently so one healthy provider cannot mask the other. `on()`
          // is needed because the uptime side carries no provider label.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(time() - max(temporal_worker_app_process_start_time_seconds{${BILLING_WORKER}})) > ${BILLED_RECONCILIATION_STALE_SECONDS.toString()} and on() (((time() - max by (provider) (${BILLED_RECONCILIATION_SUCCESS})) > ${BILLED_RECONCILIATION_STALE_SECONDS.toString()}) or ${BILLED_RECONCILIATION_MISSING_PROVIDER})`,
          ),
          for: "5m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Provider-billed LLM cost reconciliation is stale",
            description:
              "The Temporal billing worker has run for over 2 hours without reconciling both OpenAI and Anthropic billed spend, leaving provider-billed cost alerts blind. Check the temporal-billing-worker logs, Temporal poller status, and OpenAI/Anthropic admin API keys.",
          },
        },
        {
          alert: "LlmStructuredOutputExhausted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(llm_structured_output_attempts_total{outcome="exhausted"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "LLM structured output failed all validation retries",
            description:
              "An LLM structured-output call exhausted all schema validation and repair attempts in the last 15 minutes, failing the caller task after incurring token charges. Inspect the correlated trace span and redacted output archive before retrying any side-effecting workflow.",
          },
        },
        {
          alert: "LlmDailySpendHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${LIVE_COST_24H} > ${LLM_DAILY_SPEND_WARNING_USD.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: `Rolling 24h LLM spend exceeded $${LLM_DAILY_SPEND_WARNING_USD.toString()} warning ceiling`,
            description: escapePrometheusTemplate(
              `Catalog-priced 24-hour LLM token spend reached \${{ $value | humanize }}, crossing the $${LLM_DAILY_SPEND_WARNING_USD.toString()} warning threshold. Check the AI Provider Grafana dashboard by workload and model to spot unexpected usage growth.`,
            ),
          },
        },
        {
          alert: "LlmDailySpendCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${LIVE_COST_24H} > ${LLM_DAILY_SPEND_CRITICAL_USD.toString()}`,
          ),
          for: "15m",
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: `Rolling 24h LLM spend exceeded $${LLM_DAILY_SPEND_CRITICAL_USD.toString()} critical ceiling`,
            description: escapePrometheusTemplate(
              `Catalog-priced 24-hour LLM token spend reached \${{ $value | humanize }}, exceeding the $${LLM_DAILY_SPEND_CRITICAL_USD.toString()} critical ceiling and indicating a likely runaway loop or model-pin regression. Identify the top workload on the AI Provider dashboard and disable its Flipt feature flag to stop spend immediately.`,
            ),
          },
        },
        {
          alert: "LlmBilledSpendHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BILLED_COST_TODAY} > ${LLM_DAILY_SPEND_WARNING_USD.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: `Provider-billed LLM spend today exceeded $${LLM_DAILY_SPEND_WARNING_USD.toString()} warning ceiling`,
            description: escapePrometheusTemplate(
              `OpenAI and Anthropic report \${{ $value | humanize }} in billed spend for the current UTC day, crossing the $${LLM_DAILY_SPEND_WARNING_USD.toString()} warning threshold. Compare billed spend against live catalog spend on the AI Provider dashboard to see whether instrumented workloads or external usage like Codex and voice are driving costs.`,
            ),
          },
        },
        {
          alert: "LlmBilledSpendCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BILLED_COST_TODAY} > ${LLM_DAILY_SPEND_CRITICAL_USD.toString()}`,
          ),
          for: "15m",
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: `Provider-billed LLM spend today exceeded $${LLM_DAILY_SPEND_CRITICAL_USD.toString()} critical ceiling`,
            description: escapePrometheusTemplate(
              `OpenAI and Anthropic report \${{ $value | humanize }} in billed spend for the current UTC day, exceeding the $${LLM_DAILY_SPEND_CRITICAL_USD.toString()} critical threshold and risking hard provider spend-cap failures. Identify the responsible account or workload on the AI Provider dashboard and throttle or disable it before requests start failing.`,
            ),
          },
        },
        {
          alert: "LlmWorkloadCostSpike",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${liveCostByWorkload("1h")} > ${LLM_WORKLOAD_SPIKE_RATIO.toString()} * ${liveCostByWorkload("24h")} and ${liveCostByWorkload("1h")} * 3600 > ${LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            // No apostrophes in an annotation that also carries escaped Go
            // templates. An apostrophe plus the double quotes that
            // escapePrometheusTemplate emits forces the YAML emitter into
            // double-quoted style, which backslash-escapes those quotes; Helm
            // then fails to parse `{{ \"{{\" }}` with "unexpected \\ in
            // command" and every chart render breaks.
            summary: escapePrometheusTemplate(
              "LLM workload {{ $labels.workload }} cost spiked above baseline",
            ),
            description: escapePrometheusTemplate(
              "Workload {{ $labels.workload }} in {{ $labels.service }} is spending more than 5x its 24-hour average rate, risking unexpected LLM charges. Compare request rate against token cost on the AI Provider dashboard to check for traffic spikes, oversized prompts, or model changes.",
            ),
          },
        },
        {
          alert: "BirmelAdmissionClassifierErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(birmel_admission_classifier_total{outcome="error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Birmel message admission classifier is failing",
            description:
              "Birmel failed to classify at least one ambiguous follow-up message in the last 15 minutes, causing those messages to be ignored while direct mentions and replies still work. Inspect Birmel traces and logs for LLM provider or structured-output errors.",
          },
        },
        {
          alert: "BirmelMemoryExtractionErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(birmel_memory_extraction_total{outcome="error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Birmel conversation memory extraction is failing",
            description:
              "Birmel failed to extract conversation memories after at least one delivered Discord reply in the last 15 minutes, degrading long-term memory continuity while live replies still succeed. Inspect the memory extraction trace span and Birmel logs for provider or schema validation errors.",
          },
        },
      ],
    },
  ];
}
