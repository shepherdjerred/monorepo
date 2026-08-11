import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * Cluster-wide read-only RBAC for the homelab-audit-daily workflow.
 *
 * Deterministic report collectors inspect workload and infrastructure health
 * through typed JSON adapters. Legacy audit histories retain the same read
 * permissions for replay compatibility.
 *
 * Strictly read-only — no `pods/exec`, no write verbs. State-mutating
 * The generic agent prompt also forbids mutations, and the API server remains
 * a backstop if a provider disregards that policy.
 */
export function createTemporalWorkerAuditRbac(
  chart: Chart,
  serviceAccount: ServiceAccount,
): void {
  new KubeClusterRole(chart, "temporal-worker-audit-reader", {
    metadata: { name: "temporal-worker-audit-reader" },
    rules: [
      {
        apiGroups: [""],
        resources: [
          "pods",
          "pods/log",
          "services",
          "events",
          "persistentvolumeclaims",
          "persistentvolumes",
          "nodes",
          "namespaces",
          "configmaps",
          "endpoints",
        ],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["apps"],
        resources: ["deployments", "statefulsets", "daemonsets", "replicasets"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["batch"],
        resources: ["jobs", "cronjobs"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses", "networkpolicies"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["argoproj.io"],
        resources: ["applications", "applicationsets", "appprojects"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["velero.io"],
        resources: [
          "backups",
          "schedules",
          "backupstoragelocations",
          "restores",
        ],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["cert-manager.io"],
        resources: ["certificates"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["monitoring.coreos.com"],
        resources: ["servicemonitors", "prometheusrules"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["tailscale.com"],
        resources: ["connectors", "proxygroups", "proxyclasses"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "temporal-worker-audit-reader-binding", {
    metadata: { name: "temporal-worker-audit-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "temporal-worker-audit-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: serviceAccount.metadata.namespace ?? "temporal",
      },
    ],
  });

  // The deterministic TaskNotes canary reads AUTH_TOKEN only inside the
  // tasknotes-server process and emits the typed engine-status response. The
  // credential never enters the Temporal pod or activity history. Keep exec
  // permission namespace-scoped; all other audit access remains read-only.
  new KubeRole(chart, "temporal-worker-tasknotes-engine-status", {
    metadata: {
      name: "temporal-worker-tasknotes-engine-status",
      namespace: "tasknotes",
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
    ],
  });
  new KubeRoleBinding(
    chart,
    "temporal-worker-tasknotes-engine-status-binding",
    {
      metadata: {
        name: "temporal-worker-tasknotes-engine-status",
        namespace: "tasknotes",
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: "temporal-worker-tasknotes-engine-status",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.name,
          namespace: serviceAccount.metadata.namespace ?? "temporal",
        },
      ],
    },
  );
}
