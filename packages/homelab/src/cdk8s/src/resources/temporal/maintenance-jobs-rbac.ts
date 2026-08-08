import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export function createTemporalWorkerMaintenanceJobRbac(
  chart: Chart,
  serviceAccount: ServiceAccount,
): void {
  for (const namespace of ["buildkite", "media"] as const) {
    const id = namespace === "buildkite" ? "buildkite" : "media";
    new KubeRole(chart, `temporal-worker-${id}-maintenance-jobs`, {
      metadata: {
        name: "temporal-worker-maintenance-jobs",
        namespace,
      },
      rules: [
        {
          apiGroups: ["batch"],
          resources: ["jobs"],
          verbs: ["create", "get", "list", "watch", "delete"],
        },
      ],
    });

    new KubeRoleBinding(
      chart,
      `temporal-worker-${id}-maintenance-jobs-binding`,
      {
        metadata: {
          name: "temporal-worker-maintenance-jobs",
          namespace,
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: "temporal-worker-maintenance-jobs",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: serviceAccount.name,
            namespace: chart.namespace ?? "temporal",
          },
        ],
      },
    );
  }
}
