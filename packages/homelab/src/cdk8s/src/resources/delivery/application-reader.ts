import type { Chart } from "cdk8s";
import {
  KubeRole,
  KubeRoleBinding,
  KubeServiceAccount,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { DELIVERY_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/namespace.ts";

export const DELIVERY_APPLICATION_READER = "delivery-application-reader";
const ARGOCD_NAMESPACE = "argocd";

/**
 * Delivery's independent Application reader (model section 8, D5 and I2): a
 * Kubernetes identity that reads Application objects straight from the API
 * server, so recovery can still observe them while ArgoCD's own API is down
 * or upgrading itself. It may only get, list and watch Applications in the
 * `argocd` namespace. No token is mounted automatically; the pod that hosts
 * the reader runs as this account and projects a short-lived token, like the
 * API's ingress observer.
 */
export function createDeliveryApplicationReader(chart: Chart): void {
  new KubeServiceAccount(chart, "application-reader-account", {
    metadata: {
      name: DELIVERY_APPLICATION_READER,
      namespace: DELIVERY_NAMESPACE,
    },
    automountServiceAccountToken: false,
  });
  new KubeRole(chart, "application-reader-role", {
    metadata: {
      name: DELIVERY_APPLICATION_READER,
      namespace: ARGOCD_NAMESPACE,
    },
    rules: [
      {
        apiGroups: ["argoproj.io"],
        resources: ["applications"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });
  new KubeRoleBinding(chart, "application-reader-binding", {
    metadata: {
      name: DELIVERY_APPLICATION_READER,
      namespace: ARGOCD_NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: DELIVERY_APPLICATION_READER,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: DELIVERY_APPLICATION_READER,
        namespace: DELIVERY_NAMESPACE,
      },
    ],
  });
}
