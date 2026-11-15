import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getTasknotesRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "tasknotes-availability",
      rules: [
        {
          alert: "TasknotesPodNotRunning",
          annotations: {
            summary: "TaskNotes pod is not running",
            message: escapePrometheusTemplate(
              "TaskNotes deployment has {{ $value }} available replicas (expected 1). Task management may be unavailable.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="tasknotes", deployment="tasknotes"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TasknotesPodNotRunningCritical",
          annotations: {
            summary: "TaskNotes pod has been down for extended period",
            message: escapePrometheusTemplate(
              "TaskNotes has been unavailable for 30+ minutes. Task management is not functioning.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="tasknotes", deployment="tasknotes"} < 1',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "tasknotes-metrics",
      rules: [
        {
          alert: "TasknotesMetricsMissing",
          annotations: {
            summary: "TaskNotes metrics are missing",
            message: escapePrometheusTemplate(
              "Prometheus has no tasknotes_uptime_seconds sample. Check the ServiceMonitor and TaskNotes /metrics endpoint.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(tasknotes_uptime_seconds{namespace="tasknotes"})',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Alert on actual crash-looping, not single restarts. A routine
          // GitOps image bump rolls the pod (one restart) but never enters
          // CrashLoopBackOff, so this stays quiet on clean deploys while still
          // catching a container that is genuinely failing to stay up.
          alert: "TasknotesContainerCrashLooping",
          annotations: {
            summary: "TaskNotes container is crash-looping",
            message: escapePrometheusTemplate(
              "TaskNotes container {{ $labels.container }} is in CrashLoopBackOff. Check logs and pod events.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (namespace, pod, container) (kube_pod_container_status_waiting_reason{namespace="tasknotes", reason="CrashLoopBackOff"}) > 0',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
