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
          // The minecraft namespaces hibernate at 0 desired replicas
          // (mc-router scales them up on player connect), so their bluemap
          // probes are EXPECTED to fail while the namespace sleeps. Suppress
          // the alert whenever every StatefulSet in a minecraft-* namespace
          // has 0 desired replicas; the 10m `for` absorbs wake-up time once
          // mc-router sets desired replicas back to 1. Scoped to minecraft-*
          // so an accidental scale-to-zero anywhere else still pages.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'probe_success{job=~"probe-.*"} == 0 unless on(namespace) (sum by(namespace) (kube_statefulset_replicas{namespace=~"minecraft-.*"}) == 0)',
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
