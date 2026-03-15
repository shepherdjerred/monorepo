import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getClusterHygieneRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "cluster-hygiene",
      rules: [
        {
          alert: "ReleasedPVsAccumulating",
          annotations: {
            summary: "Released PersistentVolumes are accumulating",
            message: escapePrometheusTemplate(
              'There are {{ $value }} PersistentVolumes in "Released" state. These should be cleaned up or reclaimed.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'count(kube_persistentvolume_status_phase{phase="Released"}) > 5',
          ),
          for: "24h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PrometheusDataContinuityLost",
          annotations: {
            summary: "Prometheus TSDB data continuity is less than 24 hours",
            message: escapePrometheusTemplate(
              "Prometheus oldest TSDB data is only {{ $value | humanize }}s old. Historical data may have been lost.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - prometheus_tsdb_lowest_timestamp_seconds < 86400",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "HighBestEffortPodRatio",
          annotations: {
            summary: "High ratio of BestEffort QoS pods in the cluster",
            message: escapePrometheusTemplate(
              "{{ $value | humanizePercentage }} of pods are running with BestEffort QoS. Consider setting resource requests/limits.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'count(kube_pod_status_qos_class{qos_class="BestEffort"}) / count(kube_pod_status_qos_class) > 0.5',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
