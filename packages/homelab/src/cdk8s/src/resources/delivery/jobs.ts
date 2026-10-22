import type { Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeNamespace,
  KubeNetworkPolicy,
  KubeRole,
  KubeRoleBinding,
  KubeServiceAccount,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { LocalQueueV1Beta2 } from "@shepherdjerred/homelab/cdk8s/generated/imports/kueue.x-k8s.io.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  kubernetesApiEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { PROMETHEUS_GATEWAY_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import {
  CI_CLUSTER_QUEUE,
  DELIVERY_CLUSTER_QUEUE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { DELIVERY_PLATFORM_ITEMS } from "homelab/src/delivery-platform-grants.ts";
import {
  DELIVERY_STAGE_LOCAL_QUEUE,
  LEGACY_DELIVERY_STAGE_LOCAL_QUEUE,
} from "homelab/src/delivery-stage-admission.ts";

export const DELIVERY_WORKER_JOBS_NAMESPACE = "delivery-worker-jobs";
export const DELIVERY_PLATFORM_JOBS_NAMESPACE = "delivery-platform-jobs";

/** Disposable execution gets projected keys and no Kubernetes or vault credentials. */
export function createDeliveryJobs(
  chart: Chart,
  profile: "worker" | "platform",
  registryItemId: string,
  platformArgocdItemId?: string,
): ServiceAccount {
  if (profile === "platform" && platformArgocdItemId === undefined)
    throw new Error(
      "Platform execution requires its issued delivery-platform ArgoCD account item",
    );
  const namespace =
    profile === "worker"
      ? DELIVERY_WORKER_JOBS_NAMESPACE
      : DELIVERY_PLATFORM_JOBS_NAMESPACE;
  const controllerName = `delivery-${profile}-job-controller`;
  new KubeNamespace(chart, `${profile}-jobs-namespace`, {
    metadata: {
      name: namespace,
      namespace: "",
      labels: {
        "kueue.x-k8s.io/managed-namespace": "true",
        "pod-security.kubernetes.io/enforce": "restricted",
      },
    },
  });
  new LocalQueueV1Beta2(chart, `${profile}-stage-queue`, {
    metadata: { name: DELIVERY_STAGE_LOCAL_QUEUE, namespace },
    spec: { clusterQueue: DELIVERY_CLUSTER_QUEUE },
  });
  // A LocalQueue's ClusterQueue is immutable. Jobs from Delivery workers that
  // predate the reserved queue still name this one and share CI's quota.
  new LocalQueueV1Beta2(chart, `${profile}-jobs-queue`, {
    metadata: { name: LEGACY_DELIVERY_STAGE_LOCAL_QUEUE, namespace },
    spec: { clusterQueue: CI_CLUSTER_QUEUE },
  });
  new KubeServiceAccount(chart, `${profile}-stage-account`, {
    metadata: { name: "delivery-stage", namespace },
    automountServiceAccountToken: false,
  });
  if (profile === "platform") createRecoveryInspector(chart, namespace);
  const account = new ServiceAccount(chart, controllerName, {
    metadata: { name: controllerName },
  });
  const role = new KubeRole(chart, `${controllerName}-role`, {
    metadata: { name: controllerName, namespace },
    rules: [
      { apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get"] },
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
      { apiGroups: [""], resources: ["pods/log"], verbs: ["get"] },
    ],
  });
  new KubeRoleBinding(chart, `${controllerName}-binding`, {
    metadata: { name: controllerName, namespace },
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
  const pullSecret = {
    name: `dockerhub-pull-${namespace}`,
    itemId: registryItemId,
  };
  const platformItems = [
    pullSecret,
    ...(platformArgocdItemId === undefined
      ? []
      : [{ name: "delivery-platform-argocd", itemId: platformArgocdItemId }]),
    ...Object.entries(DELIVERY_PLATFORM_ITEMS).map(([name, { itemId }]) => ({
      name,
      itemId,
    })),
  ];
  const projectedItems = profile === "worker" ? [pullSecret] : platformItems;
  for (const { name, itemId } of projectedItems) {
    new OnePasswordItem(chart, `delivery-job-${name}`, {
      metadata: { name, namespace },
      ...(name === `dockerhub-pull-${namespace}`
        ? { type: "kubernetes.io/dockerconfigjson" }
        : {}),
      spec: { itemPath: vaultItemPath(itemId) },
    });
  }
  new KubeNetworkPolicy(chart, `${profile}-stage-network`, {
    metadata: { namespace },
    spec: {
      podSelector: { matchLabels: { app: "delivery-stage" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [
        dnsEgressRule(),
        externalHttpsEgressRule(),
        ...(profile === "platform"
          ? [
              kubernetesApiEgressRule(),
              {
                to: [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": "delivery",
                      },
                    },
                    podSelector: { matchLabels: { app: "delivery" } },
                  },
                ],
                ports: [
                  { protocol: "TCP", port: IntOrString.fromNumber(7353) },
                ],
              },
            ]
          : []),
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "temporal",
                },
              },
              podSelector: { matchLabels: { app: "temporal-server" } },
            },
          ],
          ports: [{ protocol: "TCP", port: IntOrString.fromNumber(7233) }],
        },
        ...(profile === "worker" ? [prometheusQueryEgressRule()] : []),
        ...(profile === "platform"
          ? [
              {
                to: [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": "seaweedfs",
                      },
                    },
                  },
                ],
                ports: [
                  { protocol: "TCP", port: IntOrString.fromNumber(8333) },
                ],
              },
            ]
          : []),
      ],
    },
  });
  return account;
}

/**
 * Worker proof recipes query Prometheus for Workflow pollers. NetworkPolicy
 * matches the pod port, the authenticated gateway's, not the Service's 9090.
 * Platform recipes never query it.
 */
function prometheusQueryEgressRule() {
  return {
    to: [
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
        },
      },
    ],
    ports: [
      {
        protocol: "TCP",
        port: IntOrString.fromNumber(PROMETHEUS_GATEWAY_PORT),
      },
    ],
  };
}

/** Only fixed recovery recipes mount this account. It cannot create, exec, read Secrets or leave its namespace. */
function createRecoveryInspector(chart: Chart, namespace: string) {
  const name = "delivery-recovery-inspector";
  new KubeServiceAccount(chart, "recovery-inspector-account", {
    metadata: { name, namespace },
    automountServiceAccountToken: false,
  });
  new KubeRole(chart, "recovery-inspector-role", {
    metadata: { name, namespace },
    rules: [
      { apiGroups: ["batch"], resources: ["jobs"], verbs: ["get"] },
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
    ],
  });
  new KubeRoleBinding(chart, "recovery-inspector-binding", {
    metadata: { name, namespace },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
    subjects: [{ kind: "ServiceAccount", name, namespace }],
  });
}
