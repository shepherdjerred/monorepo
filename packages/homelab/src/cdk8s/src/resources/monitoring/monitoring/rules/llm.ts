import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Daily spend ceilings for `llm_cost_usd_total`, in USD.
 *
 * Anchored on the measured distribution of `BILLED_COST_24H`, not on a guess:
 * a 7-day mean of ~$8.20/day and a worst observed rolling 24h of ~$20.80.
 * Warning sits at roughly 2x that worst real day and 5x the mean; critical at
 * roughly 3.5x the worst day and 9x the mean.
 *
 * The headroom is deliberate. These exist to catch a runaway agent loop or a
 * model-pin change -- an order-of-magnitude event -- not to police normal
 * variance, and normal variance here is already a 4x spread between a quiet day
 * and a busy one. Tightening them toward the mean would page on a busy Sunday.
 *
 * Re-derive rather than nudge these if the fleet's shape changes:
 *   max_over_time(<BILLED_COST_24H>[7d:1h])
 */
export const LLM_DAILY_SPEND_WARNING_USD = 40;
export const LLM_DAILY_SPEND_CRITICAL_USD = 75;

/**
 * A workload must both spike relative to its own daily rate AND clear this
 * hourly floor before it alerts. Without the floor, a workload that normally
 * costs fractions of a cent trips the ratio on any burst of ordinary traffic.
 *
 * Both sides of the comparison use `billedCost`, not `type="actual"` alone. A
 * BYOK workload reports `actual` of exactly zero, so an actual-only ratio and
 * floor would both stay at zero and the alert could never detect a runaway in
 * precisely the class of workload the daily ceilings exist to catch.
 */
export const LLM_WORKLOAD_SPIKE_RATIO = 5;
export const LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR = 0.5;

/**
 * Billed LLM cost, as one expression every cost alert is built from.
 *
 * `actual` is what OpenRouter charged. For BYOK routes OpenRouter charges
 * nothing and the real money is in `upstream` (`upstream_inference_cost`), so an
 * `actual`-only expression would miss the largest single line item in the fleet.
 * Taking the per-model maximum of the two covers both without double counting,
 * because they are equal on ordinary non-BYOK routes.
 *
 * The inner `sum` is load-bearing and must stay inside the `max`. These series
 * carry `pod` and `instance`, so a deploy inside the window leaves two counter
 * series per workload. Selecting the maximum first would keep only the larger
 * pod lifetime -- $5 before a restart and $5 after would evaluate as $5, not
 * $10, and silently understate spend after every deploy. Summing per accounting
 * type first collapses those lifetimes, and only then is the larger of `actual`
 * and `upstream` chosen.
 *
 * Conservative on purpose, pending the OpenRouter Broadcast comparison that
 * will settle the `actual` vs `upstream` semantics: a spend alert should err
 * toward firing.
 */
function billedCost(input: {
  aggregation: "increase" | "rate";
  window: string;
}): string {
  const selector = `llm_cost_usd_total{type=~"actual|upstream"}`;
  const perType = `sum by (service, workload, model, type) (${input.aggregation}(${selector}[${input.window}]))`;
  return `max by (service, workload, model) (${perType})`;
}

/** Fleet-wide billed spend over 24h, for the daily ceilings. */
const BILLED_COST_24H = `sum(${billedCost({ aggregation: "increase", window: "24h" })})`;

/** Billed spend per workload, for the spike comparison. */
function billedCostByWorkload(window: string): string {
  return `sum by (service, workload) (${billedCost({ aggregation: "rate", window })})`;
}

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
        {
          // Keeps `workload`, unlike the dashboard's inline actual-minus-catalog
          // expression, so a per-feature pricing drift is attributable to the
          // feature that caused it.
          record: "llm:cost_discrepancy:rate5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (service, workload, model) (rate(llm_cost_usd_total{type="actual"}[5m])) - sum by (service, workload, model) (rate(llm_cost_usd_total{type="catalog"}[5m]))',
          ),
        },
      ],
    },
    {
      name: "llm.alerts",
      interval: "30s",
      rules: [
        {
          alert: "LlmOpenRouterMetadataMissing",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(llm_openrouter_metadata_missing_total[15m])) > 0",
          ),
          for: "5m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "OpenRouter responses are missing router metadata",
            description: escapePrometheusTemplate(
              "At least one successful OpenRouter JSON response or final SSE chunk lacked router metadata for 5 minutes. Generation cost may still be available, but upstream provider, region, and fallback evidence are incomplete. Check OpenRouter Broadcast and application logs before treating provider attribution as authoritative.",
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
            `${BILLED_COST_24H} > ${LLM_DAILY_SPEND_WARNING_USD.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "LLM spend over the last 24h exceeded the warning ceiling",
            description: escapePrometheusTemplate(
              "Rolling 24h LLM spend crossed the warning ceiling. The figure takes the per-series maximum of OpenRouter's charged cost and upstream inference cost, so it includes BYOK routes that bill nothing through OpenRouter. Break the total down by workload on the AI Provider dashboard before assuming this is organic growth.",
            ),
          },
        },
        {
          alert: "LlmDailySpendCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BILLED_COST_24H} > ${LLM_DAILY_SPEND_CRITICAL_USD.toString()}`,
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
          alert: "LlmWorkloadCostSpike",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${billedCostByWorkload("1h")} > ${LLM_WORKLOAD_SPIKE_RATIO.toString()} * ${billedCostByWorkload("24h")} and ${billedCostByWorkload("1h")} * 3600 > ${LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR.toString()}`,
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
          alert: "OpenRouterBroadcastSilent",
          // `last_success` is 0 until the first delivery ever lands, so
          // `time() - last_success` covers both "never configured" and "went
          // stale" without a separate == 0 branch. Gating on process uptime
          // keeps a pod restart, which resets the gauge, from alerting before
          // the service has had a full day to receive anything.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(time() - max(openrouter_broadcast_ingest_process_start_time_seconds)) > 86400 and (time() - max(openrouter_broadcast_last_success_timestamp_seconds)) > 86400",
          ),
          for: "30m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary:
              "OpenRouter Broadcast has been up for a day without a successful delivery",
            description: escapePrometheusTemplate(
              "The Broadcast ingest is running and scrapeable but has not completed an archive-plus-forward in 24h. The usual cause is that the webhook was never configured on OpenRouter, which leaves the authoritative per-generation cost record unavailable while the service looks healthy. See the enable-openrouter-broadcast how-to; do not acknowledge from pod health.",
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
        {
          alert: "OpenRouterBroadcastPipelineFailure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(openrouter_broadcast_requests_total{outcome=~"archive_error|forward_error"}[10m])) > 0',
          ),
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: "OpenRouter Broadcast archival or Tempo forwarding failed",
            description: escapePrometheusTemplate(
              "The Broadcast endpoint returned failure because the full redacted OTLP payload was not durably archived or the body-free trace was not forwarded to Tempo. OpenRouter will redeliver; inspect openrouter_broadcast_operations_total and service logs before rotating credentials.",
            ),
          },
        },
        {
          alert: "OpenRouterBroadcastTargetDown",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(up{namespace="openrouter-broadcast-ingest",service="openrouter-broadca-openrouter-broadcast-ingest-service"}) or max(up{namespace="openrouter-broadcast-ingest",service="openrouter-broadca-openrouter-broadcast-ingest-service"}) == 0',
          ),
          for: "5m",
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: "OpenRouter Broadcast ingest is not scrapeable",
            description: escapePrometheusTemplate(
              "Prometheus has been unable to scrape the dedicated Broadcast metrics endpoint for 5 minutes. The public webhook may also be unavailable; check the deployment, ServiceMonitor, NetworkPolicy, and Cloudflare tunnel probe.",
            ),
          },
        },
      ],
    },
  ];
}
