import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr as Expr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import publication from "@shepherdjerred/glitter-boys-launcher/published-release.json";
import { parsePublicationRecord } from "@shepherdjerred/glitter-boys-launcher/publication";

/** Prometheus evaluates the verified publication deadline; no signing credentials or recurring job. */
export function getGlitterLauncherReleaseRuleGroups(
  record: unknown = publication,
): PrometheusRuleSpecGroups[] {
  const { release } = parsePublicationRecord(record);
  if (release === null) return [];
  const remaining = `(vector(${String(release.expires)}) - time())`;
  return [
    {
      name: "glitter-launcher-release",
      rules: [
        {
          alert: "GlitterLauncherManifestExpiring",
          expr: Expr.fromString(
            `${remaining} < 14 * 86400 and ${remaining} > 3 * 86400`,
          ),
          for: "1h",
          labels: { severity: "warning", component: "glitter-boys-launcher" },
          annotations: {
            summary: "Glitter Boys update metadata expires within 14 days",
            description: `Release ${release.version} expires at ${new Date(release.expires * 1000).toISOString()}. Run release:refresh-manifest on the Windows signing PC, then commit published-release.json and deploy the monitoring chart.`,
          },
        },
        {
          alert: "GlitterLauncherManifestExpiryCritical",
          expr: Expr.fromString(`${remaining} <= 3 * 86400`),
          for: "15m",
          labels: { severity: "critical", component: "glitter-boys-launcher" },
          annotations: {
            summary:
              "Glitter Boys update metadata is expired or expires within three days",
            description:
              "Renew with release:refresh-manifest from the Windows signing PC. Installed launchers reject expired metadata. Commit the verified publication record and deploy monitoring after renewal.",
          },
        },
      ],
    },
  ];
}
