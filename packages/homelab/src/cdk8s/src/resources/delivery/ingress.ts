import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { ServiceAccount, type Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
  type PolicyRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { DELIVERY_TAILSCALE_INGRESS as ingress } from "@shepherdjerred/ops-model/delivery-ingress.ts";

/** Existing operator supplies identity; the API independently verifies the actual proxy peer. */
export function createDeliveryIngressObserver(deployment: Deployment) {
  const chart = Chart.of(deployment);
  // Preserve the narrowly guarded optional Forum CONNECT actor. Without the
  // Forum capability this account only receives the read-only roles below.
  const account = new ServiceAccount(chart, "api-observer", {
    metadata: { name: "delivery-forum-observer" },
    automountToken: false,
  });
  for (const [namespace, rules] of [
    [
      ingress.namespace,
      [
        {
          apiGroups: ["networking.k8s.io"],
          resources: ["ingresses"],
          resourceNames: [ingress.name],
          verbs: ["get"],
        },
      ],
    ],
    [
      ingress.proxyNamespace,
      [
        { apiGroups: [""], resources: ["pods"], verbs: ["list"] },
        { apiGroups: ["apps"], resources: ["statefulsets"], verbs: ["get"] },
      ],
    ],
  ] satisfies [string, PolicyRule[]][]) {
    const name = "delivery-ingress-observer";
    new KubeRole(chart, `${namespace}-ingress-observer-role`, {
      metadata: { name, namespace },
      rules: [...rules],
    });
    new KubeRoleBinding(chart, `${namespace}-ingress-observer-binding`, {
      metadata: { name, namespace },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
      subjects: [
        {
          kind: "ServiceAccount",
          name: account.name,
          namespace: ingress.namespace,
        },
      ],
    });
  }
  // Project a short-lived Kubernetes identity only into the API. Neither the
  // database migration nor any operator proxy receives this token.
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/serviceAccountName", account.name),
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: "ingress-observer",
      projected: {
        defaultMode: 0o440,
        sources: [
          { serviceAccountToken: { path: "token", expirationSeconds: 600 } },
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
      name: "ingress-observer",
      mountPath: "/var/run/delivery-ingress",
      readOnly: true,
    }),
  );
  return account;
}
