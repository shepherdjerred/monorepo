import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { ServiceAccount, type Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
  type PolicyRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export type TailscaleIngressObserverOptions = {
  readonly accountConstructId: string;
  readonly accountName: string;
  readonly roleName: string;
  readonly constructSuffix: string;
  readonly ingressNamespace: string;
  readonly ingressName: string;
  readonly proxyNamespace: string;
  readonly mountPath: string;
};

/**
 * Grants a workload's primary container a short-lived, read-only projected
 * ServiceAccount token restricted to reading its fixed Tailscale Ingress and
 * the Tailscale proxy namespace's Pod and StatefulSet metadata.
 */
export function createTailscaleIngressObserver(
  deployment: Deployment,
  options: TailscaleIngressObserverOptions,
): ServiceAccount {
  const chart = Chart.of(deployment);
  const account = new ServiceAccount(chart, options.accountConstructId, {
    metadata: { name: options.accountName },
    automountToken: false,
  });
  const grants: [string, PolicyRule[]][] = [
    [
      options.ingressNamespace,
      [
        {
          apiGroups: ["networking.k8s.io"],
          resources: ["ingresses"],
          resourceNames: [options.ingressName],
          verbs: ["get"],
        },
      ],
    ],
    [
      options.proxyNamespace,
      [
        { apiGroups: [""], resources: ["pods"], verbs: ["list"] },
        { apiGroups: ["apps"], resources: ["statefulsets"], verbs: ["get"] },
      ],
    ],
  ];
  for (const [namespace, rules] of grants) {
    new KubeRole(chart, `${namespace}-${options.constructSuffix}-role`, {
      metadata: { name: options.roleName, namespace },
      rules: [...rules],
    });
    new KubeRoleBinding(
      chart,
      `${namespace}-${options.constructSuffix}-binding`,
      {
        metadata: { name: options.roleName, namespace },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: options.roleName,
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: account.name,
            namespace: options.ingressNamespace,
          },
        ],
      },
    );
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
      mountPath: options.mountPath,
      readOnly: true,
    }),
  );
  return account;
}
