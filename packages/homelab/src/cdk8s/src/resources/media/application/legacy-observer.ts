import type { Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/** Read-only evidence observer. No secret, exec, scale, or mutation authority. */
export function createLegacyObserverAccount(chart: Chart) {
  const account = new ServiceAccount(chart, "media-legacy-observer-account", {
    metadata: { name: "media-network" },
  });
  const role = new KubeRole(chart, "media-legacy-observer-role", {
    metadata: { name: "media-legacy-observer", namespace: "media" },
    rules: [
      {
        apiGroups: ["apps"],
        resources: ["deployments", "replicasets", "statefulsets", "daemonsets"],
        verbs: ["get", "list"],
      },
      { apiGroups: [""], resources: ["pods"], verbs: ["list"] },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        verbs: ["get"],
      },
      {
        apiGroups: ["batch"],
        resources: ["jobs", "cronjobs"],
        verbs: ["list"],
      },
      {
        apiGroups: ["autoscaling"],
        resources: ["horizontalpodautoscalers"],
        verbs: ["list"],
      },
    ],
  });
  new KubeRoleBinding(chart, "media-legacy-observer-binding", {
    metadata: { namespace: "media" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: role.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: account.name,
        namespace: chart.namespace,
      },
    ],
  });
  return account;
}
