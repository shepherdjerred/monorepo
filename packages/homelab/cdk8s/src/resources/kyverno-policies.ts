import { Chart, ApiObject } from "cdk8s";

/**
 * Creates Kyverno ClusterPolicy to automatically add velero backup labels
 * to PVCs that cannot be labeled via their Helm charts.
 *
 * Targets:
 * - Prometheus/Alertmanager PVCs (volumeClaimTemplate limitation)
 * - Zalando postgres-operator PVCs (CRD limitation)
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
                  names: ["prometheus-*", "alertmanager-*", "pgdata-grafana-*"],
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
      ],
    },
  });
}
