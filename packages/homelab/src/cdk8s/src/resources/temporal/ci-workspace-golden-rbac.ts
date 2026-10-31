import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { CI_WORKSPACE_GOLDEN_CONFIG_MAP } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/workspace-clone-policy.ts";

export const CI_WORKSPACE_GOLDEN_ROLE = "temporal-worker-ci-workspace-golden";

/**
 * Lets the infra worker's `publishCiWorkspaceGoldenSnapshot` snapshot the
 * golden workspace claim, point the workspace clone policy's parameter at the
 * new snapshot, and delete superseded snapshots. A snapshot that still has
 * workspace clones stays until they are gone; ZFS refuses to destroy it.
 *
 * Creating the parameter ConfigMap cannot be limited by name; reading and
 * updating it can.
 */
export function createTemporalWorkerCiWorkspaceGoldenRbac(
  chart: Chart,
  serviceAccounts: readonly ServiceAccount[],
): void {
  new KubeRole(chart, "temporal-worker-ci-workspace-golden", {
    metadata: {
      name: CI_WORKSPACE_GOLDEN_ROLE,
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    rules: [
      {
        apiGroups: ["snapshot.storage.k8s.io"],
        resources: ["volumesnapshots"],
        verbs: ["create", "get", "list", "delete"],
      },
      { apiGroups: [""], resources: ["configmaps"], verbs: ["create"] },
      {
        apiGroups: [""],
        resources: ["configmaps"],
        resourceNames: [CI_WORKSPACE_GOLDEN_CONFIG_MAP],
        verbs: ["get", "update"],
      },
    ],
  });
  new KubeRoleBinding(chart, "temporal-worker-ci-workspace-golden-binding", {
    metadata: {
      name: CI_WORKSPACE_GOLDEN_ROLE,
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: CI_WORKSPACE_GOLDEN_ROLE,
    },
    subjects: serviceAccounts.map((serviceAccount) => ({
      kind: "ServiceAccount",
      name: serviceAccount.name,
      namespace: serviceAccount.metadata.namespace ?? "temporal",
    })),
  });
}
