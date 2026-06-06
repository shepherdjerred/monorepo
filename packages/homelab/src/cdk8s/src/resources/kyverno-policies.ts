import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";

/**
 * Creates Kyverno ClusterPolicy to automatically add velero backup labels
 * to PVCs that cannot be labeled via their Helm charts.
 *
 * Targets:
 * - Prometheus/Alertmanager PVCs (volumeClaimTemplate limitation)
 * - Zalando postgres-operator PVCs (CRD limitation)
 * - Large bulk/cache PVCs that should be excluded from Velero backups
 *   (StatefulSet volumeClaimTemplate limitation)
 */
export function createVeleroBackupLabelPolicy(chart: Chart) {
  return new ApiObject(chart, "velero-backup-label-policy", {
    apiVersion: "kyverno.io/v1",
    kind: "ClusterPolicy",
    metadata: {
      name: "add-velero-backup-label",
    },
    spec: {
      rules: [
        {
          name: "label-prometheus-pvcs",
          match: {
            any: [
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["prometheus"],
                  names: [
                    "alertmanager-*",
                    "pgdata-grafana-*",
                    "storage-prometheus-grafana-*",
                  ],
                },
              },
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["plausible"],
                  names: ["pgdata-*"],
                },
              },
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["bugsink"],
                  names: ["pgdata-*"],
                },
              },
            ],
          },
          mutate: {
            patchStrategicMerge: {
              metadata: {
                labels: {
                  "velero.io/backup": "enabled",
                },
              },
            },
          },
        },
        {
          // Large StatefulSet PVCs that are intentionally NOT backed up by
          // Velero: the Prometheus TSDB (retention-bounded), the SeaweedFS bulk
          // object store (own replication), and the Dagger BuildKit engine cache
          // (reproducible). Their charts create the PVCs from volumeClaimTemplates
          // with no label hook, so without this they read as "undecided" and page
          // VeleroLargePVCMayImpactBackups (PagerDuty 5335-5339).
          name: "exclude-large-bulk-pvcs",
          match: {
            any: [
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["prometheus"],
                  names: [
                    "prometheus-prometheus-kube-prometheus-prometheus-db-*",
                  ],
                },
              },
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["seaweedfs"],
                  names: ["data-seaweedfs-volume-*"],
                },
              },
              {
                resources: {
                  kinds: ["PersistentVolumeClaim"],
                  namespaces: ["dagger"],
                  names: ["data-dagger-dagger-helm-engine-*"],
                },
              },
            ],
          },
          mutate: {
            patchStrategicMerge: {
              metadata: {
                labels: {
                  "velero.io/backup": "disabled",
                  "velero.io/exclude-from-backup": "true",
                },
              },
            },
          },
        },
      ],
    },
  });
}
