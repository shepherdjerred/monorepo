import { ApiObject, JsonPatch, type Chart } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
  KubeSecret,
  KubeServiceAccount,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { DELIVERY_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/namespace.ts";

export const DELIVERY_APPLICATION_READER = "delivery-application-reader";
/** Where the Delivery API reads this identity's `token` and `ca.crt`. */
export const DELIVERY_APPLICATION_READER_DIRECTORY =
  "/var/run/delivery-application-reader";
const DELIVERY_APPLICATION_READER_TOKEN = `${DELIVERY_APPLICATION_READER}-token`;
const ARGOCD_NAMESPACE = "argocd";

/**
 * Delivery's independent Application reader (model section 8, D5 and I2): a
 * Kubernetes identity that reads Application objects straight from the API
 * server, so recovery can still observe them while ArgoCD's own API is down
 * or upgrading itself. It may only get, list and watch Applications in the
 * `argocd` namespace.
 *
 * The API pod keeps its own ServiceAccount (`delivery-forum-observer`), and a
 * projected token is always issued for the pod's own account, so this
 * identity's credential is a ServiceAccount token Secret the control plane
 * populates. Its token does not expire until the Secret is deleted; the Role
 * bounds what it can do.
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
  new KubeSecret(chart, "application-reader-token", {
    metadata: {
      name: DELIVERY_APPLICATION_READER_TOKEN,
      namespace: DELIVERY_NAMESPACE,
      annotations: {
        "kubernetes.io/service-account.name": DELIVERY_APPLICATION_READER,
      },
    },
    type: "kubernetes.io/service-account-token",
  });
}

/** Mounts the reader's token and cluster CA, read-only, into the API container only. */
export function mountDeliveryApplicationReader(deployment: Deployment): void {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: "application-reader",
      secret: {
        secretName: DELIVERY_APPLICATION_READER_TOKEN,
        defaultMode: 0o440,
        items: [
          { key: "token", path: "token" },
          { key: "ca.crt", path: "ca.crt" },
        ],
      },
    }),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name: "application-reader",
      mountPath: DELIVERY_APPLICATION_READER_DIRECTORY,
      readOnly: true,
    }),
  );
}
