import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * Cluster-wide read-only RBAC for the homelab-audit-daily workflow.
 *
 * The audit agent walks `packages/docs/guides/2026-04-04_homelab-audit-runbook.md`
 * (talos / k8s workloads / argocd / velero / cert-manager / monitoring) and
 * needs LIST/GET on the resources every section touches, in every namespace.
 *
 * Strictly read-only — no `pods/exec`, no write verbs. State-mutating
 * actions are forbidden in the agent prompt and should fail at the API
 * server even if the agent disregards that.
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
}
