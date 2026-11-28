import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getArgoCDRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Argo CD application monitoring
    {
      name: "argocd-applications",
      rules: [
        {
          alert: "ArgoAppMissing",
          annotations: {
            summary: "Argo CD is not reporting any applications",
            description:
              "Argo CD has not exported application metrics for 15 minutes, so GitOps reconciliation or metrics scraping may be down and cluster state can drift undetected. Check pods and logs in the argocd namespace and verify the Argo CD ServiceMonitor target in Prometheus.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "absent(argocd_app_info) == 1",
          ),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ArgoAppComparisonError",
          annotations: {
            summary: escapePrometheusTemplate(
              "Argo CD application {{ $labels.name }} comparison failed",
            ),
            description: escapePrometheusTemplate(
              "Argo CD application {{ $labels.name }} has reported sync_status Unknown for 15 minutes because manifest rendering or diff comparison failed (ComparisonError). Inspect status.conditions on the Application in Argo CD and fix the chart values, immutable field diff, or compare-options.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'argocd_app_info{sync_status="Unknown"} == 1',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ArgoAppNotSynced",
          annotations: {
            summary: escapePrometheusTemplate(
              "Argo CD application {{ $labels.name }} is out of sync",
            ),
            description: escapePrometheusTemplate(
              "Argo CD application {{ $labels.name }} has remained out of sync for over 14 days, leaving live cluster resources drifted from Git. Inspect the application diff and sync errors in Argo CD and reconcile or fix the blocking manifest.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'argocd_app_info{sync_status!="Synced"} == 1',
          ),
          for: "14d",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
