import type { Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export const GOLINK_TAILSCALE_STATE_SECRET = "golink-tailscale-state";

export function createGolinkRbac(chart: Chart): ServiceAccount {
  const serviceAccount = new ServiceAccount(chart, "golink-sa", {
    metadata: { name: "golink" },
    automountToken: true,
  });

  new KubeRole(chart, "golink-tailscale-state-role", {
    metadata: { name: "golink-tailscale-state", namespace: "golink" },
    rules: [
      {
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["secrets"],
        resourceNames: [GOLINK_TAILSCALE_STATE_SECRET],
        verbs: ["get", "patch", "update"],
      },
      {
        apiGroups: [""],
        resources: ["events"],
        verbs: ["get", "create", "patch"],
      },
    ],
  });

  new KubeRoleBinding(chart, "golink-tailscale-state-binding", {
    metadata: { name: "golink-tailscale-state", namespace: "golink" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "golink-tailscale-state",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: "golink",
      },
    ],
  });

  new KubeClusterRole(chart, "golink-discovery-reader", {
    metadata: { name: "golink-discovery-reader" },
    rules: [
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["get", "list"],
      },
      {
        apiGroups: [""],
        resources: ["services"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "golink-discovery-reader-binding", {
    metadata: { name: "golink-discovery-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "golink-discovery-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: "golink",
      },
    ],
  });

  return serviceAccount;
}
