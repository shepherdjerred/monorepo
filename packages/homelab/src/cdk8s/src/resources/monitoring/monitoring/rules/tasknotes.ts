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
            description: escapePrometheusTemplate(
              "The tasknotes deployment in namespace tasknotes has {{ $value }} available replicas (expected 1) for over 5 minutes, interrupting task sync across clients. Check pod status, events, and container logs in the tasknotes namespace.",
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
            summary: "TaskNotes has been down for over 30 minutes",
            description: escapePrometheusTemplate(
              "The tasknotes deployment in namespace tasknotes has had {{ $value }} available replicas for over 30 minutes, leaving TaskNotes sync unavailable to all clients. Inspect pod scheduling, crash logs, and database connectivity in the tasknotes namespace.",
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
            summary: "TaskNotes Prometheus metrics are missing",
            description:
              "Prometheus has received no uptime metrics from TaskNotes in the last 5 minutes, blinding service health visibility even if the pod appears running. Check the TaskNotes /metrics endpoint and its ServiceMonitor in the tasknotes namespace.",
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
            summary: "TaskNotes service is crashing repeatedly",
            description: escapePrometheusTemplate(
              "Container {{ $labels.container }} in pod {{ $labels.pod }} (namespace tasknotes) has been in CrashLoopBackOff for over 5 minutes, degrading or stopping TaskNotes sync. Inspect previous container logs with kubectl logs --previous and check pod events.",
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
