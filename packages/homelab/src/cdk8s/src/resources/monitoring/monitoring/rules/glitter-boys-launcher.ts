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
            description: `Glitter Boys launcher release ${release.version} metadata expires at ${new Date(release.expires * 1000).toISOString()}, after which installed launchers will reject update checks. Run release:refresh-manifest on the Windows signing PC, commit published-release.json, and deploy monitoring.`,
          },
        },
        {
          alert: "GlitterLauncherManifestExpiryCritical",
          expr: Expr.fromString(`${remaining} <= 3 * 86400`),
          for: "15m",
          labels: { severity: "critical", component: "glitter-boys-launcher" },
          annotations: {
            summary: "Glitter Boys update metadata is expired or expiring soon",
            description: `Glitter Boys launcher release ${release.version} metadata expires at ${new Date(release.expires * 1000).toISOString()} (under 3 days or already expired), causing installed launchers to reject update checks once expired. Run release:refresh-manifest on the Windows signing PC immediately, commit published-release.json, and deploy monitoring.`,
          },
        },
      ],
    },
  ];
}
