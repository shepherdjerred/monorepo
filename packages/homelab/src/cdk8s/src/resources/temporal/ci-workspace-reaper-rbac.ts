import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

export const CI_WORKSPACE_REAPER_ROLE = "temporal-worker-ci-workspace-reaper";

/**
 * Lets the infra worker's `runCiWorkspaceReaperWorkflow` delete Woodpecker
 * step pods and workspace claims that outlived their workflow.
 *
 * Namespace-scoped to the CI namespace and limited to listing and deleting
 * pods and claims: the reaper chooses targets from one listing and deletes
 * them by name with a UID precondition, so it needs neither `get` nor
 * `watch`. The grant lives on the infra worker rather than on the CI
 * namespace's maintenance worker, which keeps that pod -- it also runs
 * Kometa -- without an API token.
 */
export function createTemporalWorkerCiWorkspaceReaperRbac(
  chart: Chart,
  serviceAccounts: readonly ServiceAccount[],
): void {
  new KubeRole(chart, "temporal-worker-ci-workspace-reaper", {
    metadata: {
      name: CI_WORKSPACE_REAPER_ROLE,
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "persistentvolumeclaims"],
        verbs: ["list", "delete"],
      },
    ],
  });
  new KubeRoleBinding(chart, "temporal-worker-ci-workspace-reaper-binding", {
    metadata: {
      name: CI_WORKSPACE_REAPER_ROLE,
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: CI_WORKSPACE_REAPER_ROLE,
    },
    subjects: serviceAccounts.map((serviceAccount) => ({
      kind: "ServiceAccount",
      name: serviceAccount.name,
      namespace: serviceAccount.metadata.namespace ?? "temporal",
    })),
  });
}
