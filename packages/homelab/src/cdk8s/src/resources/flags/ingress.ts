import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { ServiceAccount, type Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
  type PolicyRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/** Fixed operator-owned human ingress; this is identity policy, never selected release state. */
export const FLAGS_TAILSCALE_INGRESS = {
  namespace: "flags",
  name: "flags-flags-ingress-ingress",
  proxyNamespace: "tailscale",
  serviceName: "flags",
  port: 7360,
  host: "flags",
  directory: "/var/run/flags-ingress",
  parentLabels: {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource-type": "ingress",
    "tailscale.com/parent-resource-ns": "flags",
    "tailscale.com/parent-resource": "flags-flags-ingress-ingress",
  },
} as const;

const ingress = FLAGS_TAILSCALE_INGRESS;

/** Tailscale supplies operator headers; Flags independently verifies the actual proxy peer IP. */
export function createFlagsIngressObserver(deployment: Deployment) {
  const chart = Chart.of(deployment);
  const account = new ServiceAccount(chart, "flags-ingress-observer-account", {
    metadata: { name: "flags-ingress-observer" },
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
    const name = "flags-ingress-observer";
    new KubeRole(chart, `${namespace}-flags-ingress-observer-role`, {
      metadata: { name, namespace },
      rules: [...rules],
    });
    new KubeRoleBinding(chart, `${namespace}-flags-ingress-observer-binding`, {
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
      mountPath: ingress.directory,
      readOnly: true,
    }),
  );
  return account;
}
