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
            summary: "StormBrain is burning cost far above its own baseline",
            description: escapePrometheusTemplate(
              "StormBrain spend is several times its own 24h rate and has cleared the hourly floor, so this is not a quiet service tripping a ratio. Compare the request rate against the cost rate: a flat request rate with rising cost means longer prompts or a model change, not more tickets.",
            ),
          },
        },
        {
          alert: "StormBrainLatencyHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${LATENCY_P95} > ${STORM_BRAIN_LATENCY_P95_SECONDS.toString()}`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain p95 latency is degraded",
            description: escapePrometheusTemplate(
              "StormBrain p95 request latency has been above 30s for 15 minutes. The service LLM timeout is 60s and the plugin waits 65s, so sustained slowness here becomes client timeouts next. Check OpenAI latency and the classify versus triage breakdown before touching timeouts.",
            ),
          },
        },
        {
          alert: "StormBrainRequestErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(storm_brain_requests_total{outcome=~"error|upstream_error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "StormBrain requests are failing",
            description: escapePrometheusTemplate(
              "At least one StormBrain request failed with an inference or upstream error in the last 15 minutes. The plugin treats these as unjudged lines and unworked tickets, so enforcement quietly degrades while this fires. Check service logs and OpenAI status.",
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
              "At least one StormBrain request was rejected as invalid or unauthorized in the last 15 minutes. The service is reachable but the caller is wrong: a plugin and service contract mismatch, or a rotated bearer token that never reached the game server. Do not acknowledge from service health.",
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
            summary: "StormBrain is not scrapeable",
            description: escapePrometheusTemplate(
              "Prometheus has been unable to scrape the StormBrain metrics endpoint for 5 minutes. The classify and triage API may also be unavailable; check the deployment, ServiceMonitor, and NetworkPolicy.",
            ),
          },
        },
      ],
    },
  ];
}
