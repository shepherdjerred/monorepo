import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * Read-only CRD access for the homelab-crd-imports-daily schedule: its
 * activity runs `kubectl get crds -o json | cdk8s import /dev/stdin` in the
 * bot clone to regenerate generated/imports (see
 * packages/temporal/src/activities/homelab-crd-imports-refresh.ts).
 *
 * Strictly read-only — CRD definitions only, no write verbs.
 */
export function createTemporalWorkerCrdReaderRbac(
  chart: Chart,
  serviceAccount: ServiceAccount,
): void {
  new KubeClusterRole(chart, "temporal-worker-crd-reader", {
    metadata: { name: "temporal-worker-crd-reader" },
    rules: [
      {
        apiGroups: ["apiextensions.k8s.io"],
        resources: ["customresourcedefinitions"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "temporal-worker-crd-reader-binding", {
    metadata: { name: "temporal-worker-crd-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "temporal-worker-crd-reader",
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
