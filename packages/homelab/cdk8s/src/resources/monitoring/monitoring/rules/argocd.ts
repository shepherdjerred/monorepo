import { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getArgoCDRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Argo CD application monitoring
    {
      name: "argocd-applications",
      rules: [
        {
          alert: "ArgoAppMissing",
          annotations: {
            summary: "[Argo CD] No reported applications",
            description:
              "Argo CD has not reported any applications data for the past 15 minutes which means that it must be down or not functioning properly. This needs to be resolved for this cloud to continue to maintain state.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("absent(argocd_app_info) == 1"),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ArgoAppNotSynced",
          annotations: {
            summary: escapePrometheusTemplate("[{{ $labels.name }}] Application not synchronized"),
            description: escapePrometheusTemplate(
              "The application [{{ $labels.name }}] has not been synchronized for over 14 days which means that the state of this cloud has drifted away from the state inside Git.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString('argocd_app_info{sync_status!="Synced"} == 1'),
          for: "14d",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
