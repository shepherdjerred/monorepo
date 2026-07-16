import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";

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
      ],
    },
  });
}

/**
 * 2026-07 CI-freeze hardening: reports (Audit mode — does not block) any
 * container in the buildkite namespace missing explicit cpu/memory
 * resource limits. A cheap, independent backstop that surfaces drift (a
 * future container that forgets to set limits) via PolicyReport rather
 * than silently allowing it.
 *
 * Deliberately Audit, not Enforce, and deliberately `validate` (report), not
 * `mutate` (silently inject) — a mutating rule would hide gaps instead of
 * surfacing them, and this is a 160+ pod cluster where a cluster-wide
 * enforce/mutate rule risks breaking unrelated workloads. Scoped to
 * buildkite only, a namespace implicated in the incident (the dagger
 * namespace was too, before Dagger was removed from the repo). Flip to
 * Enforce in a follow-up once PolicyReports show zero drift.
 *
 * See packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md.
 */
export function createResourceLimitEnforcementPolicy(chart: Chart) {
  return new ApiObject(chart, "resource-limit-enforcement-policy", {
    apiVersion: "kyverno.io/v1",
    kind: "ClusterPolicy",
    metadata: {
      name: "enforce-container-resource-limits",
    },
    spec: {
      validationFailureAction: "Audit",
      background: true,
      rules: [
        {
          name: "require-cpu-memory-limits",
          match: {
            any: [
              {
                resources: {
                  kinds: ["Pod"],
                  namespaces: ["buildkite"],
                },
              },
            ],
          },
          validate: {
            message:
              "Containers in the buildkite namespace must set cpu and memory limits (2026-07 CI-freeze hardening).",
            pattern: {
              spec: {
                containers: [
                  {
                    resources: {
                      limits: {
                        cpu: "?*",
                        memory: "?*",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
}
