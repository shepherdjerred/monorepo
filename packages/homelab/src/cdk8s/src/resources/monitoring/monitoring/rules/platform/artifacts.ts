import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

const GIB = 1024 * 1024 * 1024;

export function getArtifactsRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "artifacts-health",
      rules: [
        {
          alert: "ArtifactsDown",
          annotations: {
            summary: "Artifacts review service is down",
            description:
              "Prometheus cannot scrape the artifacts service, so agents cannot publish for review and feedback cannot be delivered. Check pod status, container logs, the prisma-migrate init container and readiness probes in the artifacts namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="artifacts",service="artifacts"} == 0) or absent(up{namespace="artifacts",service="artifacts"})',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "ArtifactsChangeStreamDisconnected",
          annotations: {
            summary: "Artifacts has lost its change stream",
            description:
              "The artifacts service has had no LISTEN connection to PostgreSQL for 10 minutes, so open feedback waits and the review UI only learn of changes on their polling fallback. Check artifacts-postgresql pod health and the artifacts-pg-netpol and artifacts-app-netpol NetworkPolicies.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "artifacts_listen_connected == 0",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "ArtifactsCleanupStale",
          annotations: {
            summary: "Artifacts cleanup has not succeeded for 3 hours",
            description: escapePrometheusTemplate(
              "The hourly artifacts-cleanup Temporal schedule last succeeded {{ $value | humanizeDuration }} ago (a fresh service reports its first success after the schedule is unpaused). Expired boards, upload sessions and unreferenced blobs are accumulating. Check the artifacts-cleanup schedule and its latest workflow run in Temporal, the temporal-worker-artifacts-netpol egress rule, and the artifacts-enabled flag.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - artifacts_cleanup_last_success_timestamp_seconds > 3 * 3600",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ArtifactsBlobStorageLarge",
          annotations: {
            summary: "Artifact blob storage is over 50 GiB",
            description: escapePrometheusTemplate(
              "The artifacts-blobs SeaweedFS bucket holds {{ $value | humanize1024 }}B across its volumes. Archive or delete boards in the artifacts inbox, or raise this threshold deliberately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(SeaweedFS_volumeServer_total_disk_size{collection="artifacts-blobs",type="normal"}) > ${String(50 * GIB)}`,
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "ArtifactsObjectStoreErrors",
          annotations: {
            summary: "Artifacts object store operations are failing",
            description: escapePrometheusTemplate(
              "The artifacts service has recorded failing {{ $labels.op }} operations against SeaweedFS for 10 minutes, so uploads or content reads are failing. Check seaweedfs-s3 health and the artifacts-blobs bucket.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (op) (rate(artifacts_s3_errors_total[10m])) > 0",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
