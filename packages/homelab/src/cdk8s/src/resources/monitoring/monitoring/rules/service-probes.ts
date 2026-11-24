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
              "Health probe {{ $labels.path }} is failing for {{ $labels.service }}",
            ),
            description: escapePrometheusTemplate(
              "The HTTP health probe on {{ $labels.path }} for service {{ $labels.service }} in namespace {{ $labels.namespace }} has failed for over 10 minutes, indicating the service endpoint is down or returning errors. Check pod status, container logs, and ingress or service routing in namespace {{ $labels.namespace }}.",
            ),
          },
          // Deliberate maintenance can scale a minecraft-* StatefulSet to 0
          // desired replicas, and its web-map probes are expected to fail while
          // stopped. Suppress the alert whenever every StatefulSet in a
          // minecraft-* namespace has 0 desired replicas; the 10m `for` absorbs
          // startup time once desired replicas return to 1. Scoped to
          // minecraft-* so an accidental scale-to-zero anywhere else still pages.
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
              "Prometheus has collected no metrics from the service health probe fleet in the last 10 minutes, leaving hosted service endpoint outages undetected. Check prometheus-blackbox-exporter pod health and inspect Probe resources and scrape targets in the monitoring namespace.",
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
