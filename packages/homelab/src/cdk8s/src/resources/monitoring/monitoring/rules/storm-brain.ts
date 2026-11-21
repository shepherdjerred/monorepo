import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * A cost burn must both spike relative to its own 24h rate AND clear this
 * hourly floor before it alerts. Without the floor, a service this cheap
 * trips the ratio on any burst of ordinary traffic.
 *
 * Unlike the fleet LLM ceilings, these are not anchored on measured spend:
 * storm-brain has no baseline yet. The floor ($0.10/hour, ~$2.40/day if
 * sustained) catches a runaway loop or a stuck retry storm while normal Luna
 * usage stays in cents per day. Re-derive from
 * `sum(increase(storm_brain_cost_micros_total[24h]))` after the shadow soak.
 */
export const STORM_BRAIN_COST_SPIKE_RATIO = 5;
export const STORM_BRAIN_COST_FLOOR_MICROS_PER_HOUR = 100_000;

/** p95 request latency that counts as degraded, in seconds. */
export const STORM_BRAIN_LATENCY_P95_SECONDS = 30;

const COST_RATE_1H = "sum(rate(storm_brain_cost_micros_total[1h]))";
const COST_RATE_24H = "sum(rate(storm_brain_cost_micros_total[24h]))";
const LATENCY_P95 =
  "histogram_quantile(0.95, sum by (le) (rate(storm_brain_request_duration_seconds_bucket[5m])))";
const SCRAPE_SELECTOR =
  'namespace="storm-brain",service="storm-brain-storm-brain-service",endpoint="metrics"';

export function getStormBrainRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "storm-brain.alerts",
      interval: "30s",
      rules: [
        {
          alert: "StormBrainCostSpike",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${COST_RATE_1H} > ${STORM_BRAIN_COST_SPIKE_RATIO.toString()} * ${COST_RATE_24H} and ${COST_RATE_1H} * 3600 > ${STORM_BRAIN_COST_FLOOR_MICROS_PER_HOUR.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain LLM spend is spiking above baseline",
            description:
              "StormBrain hourly LLM spend exceeds 5x its 24-hour baseline rate, risking runaway API costs. Compare request volume against spend rate in Grafana and inspect logs for retry loops, enlarged prompts, or model changes.",
          },
        },
        {
          // Service LLM timeout is 60s and the Minecraft plugin waits 65s, so
          // sustained >30s p95 latency threatens client timeouts next.
          alert: "StormBrainLatencyHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${LATENCY_P95} > ${STORM_BRAIN_LATENCY_P95_SECONDS.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain p95 request latency is high",
            description: escapePrometheusTemplate(
              "StormBrain p95 request latency is {{ $value | humanizeDuration }}, risking upstream 60s timeouts and stalled ticket classification or moderation. Check OpenAI API status and compare latency across flow labels before adjusting timeouts.",
            ),
          },
        },
        {
          // Player text stays unpublished while screening runs; failed checks
          // reject text without recording misconduct strikes.
          alert: "StormContentScreeningSlow",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'histogram_quantile(0.95, sum by (le) (rate(storm_brain_request_duration_seconds_bucket{flow="moderate"}[5m]))) > 3',
          ),
          for: "10m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain player content screening is slow",
            description: escapePrometheusTemplate(
              "StormBrain content-screening p95 latency is {{ $value | humanizeDuration }}, delaying or blocking player text publication in-game. Check OpenAI moderation API status and contextual model latency.",
            ),
          },
        },
        {
          // Screening withholds publication without recording a misconduct
          // strike on failure; ticket triage stays unworked until retried.
          alert: "StormBrainRequestErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(storm_brain_requests_total{outcome=~"error|upstream_error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain requests are failing",
            description: escapePrometheusTemplate(
              "StormBrain recorded {{ $value | humanize }} inference or upstream request error(s) in the last 15 minutes, blocking content publication and leaving support tickets untriaged. Check failing flow labels, StormBrain service logs, and OpenAI API status.",
            ),
          },
        },
        {
          alert: "StormBrainRequestsRejected",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(storm_brain_requests_total{outcome=~"invalid|unauthorized"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain is rejecting plugin requests",
            description: escapePrometheusTemplate(
              "StormBrain rejected {{ $value | humanize }} plugin request(s) as invalid or unauthorized in the last 15 minutes, breaking in-game moderation and ticket requests. Check for a bearer token mismatch on the Minecraft server or a schema mismatch between the plugin and StormBrain.",
            ),
          },
        },
        {
          alert: "StormBrainTargetDown",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `absent(up{${SCRAPE_SELECTOR}}) or max(up{${SCRAPE_SELECTOR}}) == 0`,
          ),
          for: "5m",
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: "StormBrain metrics endpoint is down",
            description:
              "Prometheus has been unable to scrape the StormBrain metrics endpoint for 5 minutes, and the moderation and ticket triage API may be unavailable. Check the storm-brain deployment, ServiceMonitor, and NetworkPolicy.",
          },
        },
      ],
    },
  ];
}
