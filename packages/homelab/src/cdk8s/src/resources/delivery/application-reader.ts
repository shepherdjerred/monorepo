import { ApiObject, Chart, JsonPatch } from "cdk8s";
import type { Deployment, ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { DELIVERY_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/namespace.ts";

export const DELIVERY_APPLICATION_READER = "delivery-application-reader";
/** Where the Delivery API reads this reader's `token` and `ca.crt`. */
export const DELIVERY_APPLICATION_READER_DIRECTORY =
  "/var/run/delivery-application-reader";
const ARGOCD_NAMESPACE = "argocd";
const TOKEN_SECONDS = 600;

/**
 * Delivery's independent Application reader (model section 8, D5 and I2):
 * recovery reads Application objects straight from the API server, never
 * through ArgoCD's API, so it can still observe them while ArgoCD is down or
 * upgrading itself.
 *
 * A pod can only project a token for its own ServiceAccount, so the reader is
 * a Role on the API pod's account (`delivery-forum-observer`): get, list and
 * watch on Applications in `argocd`, nothing else. Only the API container
 * receives the short-lived token and the cluster CA, in their own directory.
 */
export function attachDeliveryApplicationReader(
  deployment: Deployment,
  account: ServiceAccount,
): void {
  const chart = Chart.of(deployment);
  new KubeRole(
    chart,
    `${ARGOCD_NAMESPACE}-${DELIVERY_APPLICATION_READER}-role`,
    {
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
    },
  );
  new KubeRoleBinding(
    chart,
    `${ARGOCD_NAMESPACE}-${DELIVERY_APPLICATION_READER}-binding`,
    {
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
          namespace: DELIVERY_NAMESPACE,
          name: account.name,
        },
      ],
    },
  );
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: DELIVERY_APPLICATION_READER,
      projected: {
        defaultMode: 0o440,
        sources: [
          {
            serviceAccountToken: {
              path: "token",
              expirationSeconds: TOKEN_SECONDS,
            },
          },
          {
            configMap: {
              name: "kube-root-ca.crt",
              items: [{ key: "ca.crt", path: "ca.crt" }],
            },
          },
        ],
      },
    }),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name: DELIVERY_APPLICATION_READER,
      mountPath: DELIVERY_APPLICATION_READER_DIRECTORY,
      readOnly: true,
    }),
  );
}
