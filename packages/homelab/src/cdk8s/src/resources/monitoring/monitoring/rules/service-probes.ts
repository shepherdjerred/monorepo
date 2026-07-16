import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// Covers every Probe emitted by resources/monitoring/service-probes-chart.ts
// (job names all start with "probe-"), which is distinct from the
// "static-site-*" job prefix in static-sites.ts.
export function getServiceProbeRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "service-probes-availability",
      rules: [
        {
          alert: "ServiceProbeDown",
          annotations: {
            summary: escapePrometheusTemplate(
              "[{{ $labels.namespace }}/{{ $labels.service }}] {{ $labels.path }} probe is down",
            ),
            description: escapePrometheusTemplate(
              "The {{ $labels.path }} probe for {{ $labels.service }} in namespace {{ $labels.namespace }} has been failing for more than 10 minutes.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'probe_success{job=~"probe-.*"} == 0',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ServiceProbeAbsent",
          annotations: {
            summary: "Service probes are not running",
            description:
              "No probe_success metrics have been collected for the service-probe fleet in the last 10 minutes. The blackbox-exporter or Probe resources may be misconfigured.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(probe_success{job=~"probe-.*"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
