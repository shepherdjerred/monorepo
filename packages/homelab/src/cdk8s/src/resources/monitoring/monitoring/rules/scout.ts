import type { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getScoutRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "scout-riot-api",
      rules: [
        {
          alert: "ScoutRiotApiErrorRateHigh",
          annotations: {
            summary: "Riot API error rate is elevated",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from source {{ $labels.source }} (status {{ $labels.http_status }}).",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, source, http_status) (rate(riot_api_errors_total[15m])) * 60 > 2",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutRiotApiErrorRateCritical",
          annotations: {
            summary: "Riot API error rate is critically high",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from source {{ $labels.source }}. Riot API may be experiencing an outage.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, source) (rate(riot_api_errors_total[15m])) * 60 > 10",
          ),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
