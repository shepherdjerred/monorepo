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
          // worker that has never succeeded; `on()` is needed because the
          // uptime side carries no provider label.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(time() - max(temporal_worker_app_process_start_time_seconds{${BILLING_WORKER}})) > ${BILLED_RECONCILIATION_STALE_SECONDS.toString()} and on() ((time() - max by (provider) (llm_billed_reconciliation_last_success_timestamp_seconds{${BILLING_WORKER}})) > ${BILLED_RECONCILIATION_STALE_SECONDS.toString()} or on() absent(llm_billed_reconciliation_last_success_timestamp_seconds{${BILLING_WORKER}}))`,
          ),
          for: "5m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Provider-billed LLM cost reconciliation is stale",
            description: escapePrometheusTemplate(
              "The isolated billing worker has been running for more than two hours without a successful OpenAI and Anthropic cost reconciliation, so the billed spend alerts are blind. Check its Temporal poller, both admin keys, and the provider API errors in its logs.",
            ),
          },
        },
        {
          alert: "LlmStructuredOutputExhausted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(llm_structured_output_attempts_total{outcome="exhausted"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Structured LLM output exhausted all semantic attempts",
            description: escapePrometheusTemplate(
              "generateValidatedObject exhausted its bounded semantic repair attempts. Every attempt was traced and charged; inspect the correlated workload span and archived redacted output instead of replaying an effectful workflow.",
            ),
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
            summary: "LLM spend over the last 24h exceeded the warning ceiling",
            description: escapePrometheusTemplate(
              "Rolling 24h LLM spend, priced from the catalog on provider-reported tokens, crossed the warning ceiling. Break the total down by workload on the AI Provider dashboard before assuming this is organic growth.",
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
            summary:
              "LLM spend over the last 24h exceeded the critical ceiling",
            description: escapePrometheusTemplate(
              "Rolling 24h LLM spend is several times the measured baseline. Identify the responsible workload before it runs another day; a runaway tool loop or a model-pin change are the usual causes. Disabling the feature flag for the offending workload is faster than rolling back an image.",
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
            summary:
              "Provider-billed LLM spend today exceeded the warning ceiling",
            description: escapePrometheusTemplate(
              "OpenAI and Anthropic report more spend for the current UTC day than the warning ceiling. Billed cost includes traffic the live series cannot price, such as Codex and voice, so compare it against the live cost on the AI Provider dashboard to find which side is growing. Provider hard caps are the backstop, not this alert.",
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
            summary:
              "Provider-billed LLM spend today exceeded the critical ceiling",
            description: escapePrometheusTemplate(
              "OpenAI and Anthropic report spend for the current UTC day several times the measured baseline. Find the responsible account on the AI Provider dashboard; a project that hits its hard spend limit starts failing requests, so act before the cap does.",
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
              "LLM workload {{ $labels.workload }} is burning cost far above its own baseline",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.service }} workload {{ $labels.workload }} is spending several times its own 24h rate and has cleared the hourly floor, so this is not a small workload tripping a ratio. Compare the request rate against the cost rate: a flat request rate with rising cost means longer prompts or a model change, not more traffic.",
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
            summary: "Birmel admission classification is failing closed",
            description: escapePrometheusTemplate(
              "At least one ambiguous Birmel follow-up could not be classified in the last 15 minutes. Direct mentions, replies, sessions, and learned aliases remain deterministic; inspect the admission span and schema or provider error before widening admission.",
            ),
          },
        },
        {
          alert: "BirmelMemoryExtractionErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(birmel_memory_extraction_total{outcome="error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Birmel post-response memory extraction is failing",
            description: escapePrometheusTemplate(
              "At least one delivered Birmel turn failed post-response memory extraction in the last 15 minutes. The Discord response was already delivered; inspect the correlated memory extraction span and structured-output error before treating continuity as healthy.",
            ),
          },
        },
      ],
    },
  ];
}
