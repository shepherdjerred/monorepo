import type { Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export function createTemporalWorkerServiceAccount(
  chart: Chart,
): ServiceAccount {
  const serviceAccount = new ServiceAccount(chart, "temporal-worker-sa", {
    metadata: { name: "temporal-worker" },
  });

  new KubeClusterRole(chart, "temporal-worker-ingress-reader", {
    metadata: { name: "temporal-worker-ingress-reader" },
    rules: [
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "temporal-worker-ingress-reader-binding", {
    metadata: { name: "temporal-worker-ingress-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "temporal-worker-ingress-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  return serviceAccount;
}

export function createTemporalWorkerMaintenanceRbac(
  chart: Chart,
  serviceAccount: ServiceAccount,
) {
  // Namespace-scoped RBAC for the ZFS maintenance workflow, which lists the
  // zfs-zpool-collector pods and execs into one Running and Ready pod per node
  // in the prometheus namespace.
  new KubeRole(chart, "temporal-worker-zfs-exec", {
    metadata: { name: "temporal-worker-zfs-exec", namespace: "prometheus" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-zfs-exec-binding", {
    metadata: { name: "temporal-worker-zfs-exec", namespace: "prometheus" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-zfs-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  // Namespace-scoped RBAC for the Bugsink housekeeping workflow, which execs
  // into the bugsink pod to run bugsink-manage maintenance commands.
  new KubeRole(chart, "temporal-worker-bugsink-exec", {
    metadata: { name: "temporal-worker-bugsink-exec", namespace: "bugsink" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-bugsink-exec-binding", {
    metadata: { name: "temporal-worker-bugsink-exec", namespace: "bugsink" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-bugsink-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  // Namespace-scoped RBAC for the Velero orphan-snapshot audit workflow.
  // Reads `velero.io/v1/Backup` CRs in the velero namespace and execs into
  // the openebs-zfs-localpv-node pod to enumerate ZFS snapshots.
  new KubeRole(chart, "temporal-worker-velero-backups-read", {
    metadata: {
      name: "temporal-worker-velero-backups-read",
      namespace: "velero",
    },
    rules: [
      {
        apiGroups: ["velero.io"],
        resources: ["backups"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-velero-backups-read-binding", {
    metadata: {
      name: "temporal-worker-velero-backups-read",
      namespace: "velero",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-velero-backups-read",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  new KubeRole(chart, "temporal-worker-openebs-exec", {
    metadata: { name: "temporal-worker-openebs-exec", namespace: "openebs" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-openebs-exec-binding", {
    metadata: { name: "temporal-worker-openebs-exec", namespace: "openebs" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-openebs-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });
}
