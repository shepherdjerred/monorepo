import type { Chart } from "cdk8s";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  MC_HARNESS_SERVICE_ACCOUNT,
  MC_LIVE_NAMESPACE,
  MC_LIVE_POD,
  MC_LIVE_STATEFULSET,
  MC_SANDBOX_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";

const VELERO_NAMESPACE = "velero";

type Rule = {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
  resourceNames?: string[];
};

/**
 * Everything the mc-harness daemon may do, as the identity it impersonates.
 *
 * The daemon runs on the operator's workstation with the operator's admin
 * kubeconfig (`admin@torvalds`, a Talos `system:masters` certificate, which
 * may impersonate any identity without an RBAC grant). It always passes
 * `--as=system:serviceaccount:mc-sandbox:mc-harness`, so the apiserver
 * enforces these rules and its audit log records the impersonation.
 *
 * - `mc-sandbox`: run disposable Paper pods, stage files into them (exec, for
 *   `kubectl cp`), stream logs, and port-forward to them.
 * - `minecraft-tsmc`: read the live server's state and port-forward or exec
 *   into its one pod. No patch, update, or delete on anything: the harness
 *   never changes replicas, annotations, or the StatefulSet (mc-router and
 *   the mining reset own those).
 * - `velero`: take and inspect Backups before risky live writes.
 */
export const MC_HARNESS_RULES: Record<string, readonly Rule[]> = {
  [MC_SANDBOX_NAMESPACE]: [
    {
      apiGroups: [""],
      resources: ["pods"],
      verbs: ["create", "get", "list", "watch", "delete"],
    },
    { apiGroups: [""], resources: ["pods/log"], verbs: ["get"] },
    { apiGroups: [""], resources: ["pods/exec"], verbs: ["create"] },
    { apiGroups: [""], resources: ["pods/portforward"], verbs: ["create"] },
    { apiGroups: [""], resources: ["events"], verbs: ["list", "watch"] },
  ],
  [MC_LIVE_NAMESPACE]: [
    {
      apiGroups: ["apps"],
      resources: ["statefulsets"],
      verbs: ["get"],
      resourceNames: [MC_LIVE_STATEFULSET],
    },
    { apiGroups: [""], resources: ["services"], verbs: ["get"] },
    { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
    {
      apiGroups: [""],
      resources: ["pods/portforward", "pods/exec"],
      verbs: ["create"],
      resourceNames: [MC_LIVE_POD],
    },
  ],
  [VELERO_NAMESPACE]: [
    {
      apiGroups: ["velero.io"],
      resources: ["backups"],
      verbs: ["create", "get", "list"],
    },
  ],
};

export function createMcHarnessRbac(chart: Chart): void {
  for (const [namespace, rules] of Object.entries(MC_HARNESS_RULES)) {
    const name = "mc-harness";
    new KubeRole(chart, `mc-harness-role-${namespace}`, {
      metadata: { name, namespace },
      rules: rules.map((rule) => ({ ...rule })),
    });
    new KubeRoleBinding(chart, `mc-harness-binding-${namespace}`, {
      metadata: { name, namespace },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
      subjects: [
        {
          kind: "ServiceAccount",
          name: MC_HARNESS_SERVICE_ACCOUNT,
          namespace: MC_SANDBOX_NAMESPACE,
        },
      ],
    });
  }
}
