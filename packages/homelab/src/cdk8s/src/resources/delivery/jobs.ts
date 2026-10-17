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
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { CI_CLUSTER_QUEUE } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";

export const DELIVERY_JOBS_NAMESPACE = "delivery-jobs";

/** Disposable execution gets projected keys and no Kubernetes or vault credentials. */
export function createDeliveryJobs(chart: Chart): ServiceAccount {
  const namespace = DELIVERY_JOBS_NAMESPACE;
  new KubeNamespace(chart, "delivery-jobs-namespace", {
    metadata: {
      name: namespace,
      labels: { "kueue.x-k8s.io/managed-namespace": "true" },
    },
  });
  new LocalQueueV1Beta2(chart, "delivery-jobs-queue", {
    metadata: { name: "default", namespace },
    spec: { clusterQueue: CI_CLUSTER_QUEUE },
  });
  new KubeServiceAccount(chart, "delivery-stage-account", {
    metadata: { name: "delivery-stage", namespace },
    automountServiceAccountToken: false,
  });
  const account = new ServiceAccount(chart, "delivery-job-controller", {
    metadata: { name: "delivery-job-controller" },
  });
  const role = new KubeRole(chart, "delivery-job-controller-role", {
    metadata: { name: "delivery-job-controller", namespace },
    rules: [
      { apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get"] },
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
      { apiGroups: [""], resources: ["pods/log"], verbs: ["get"] },
    ],
  });
  new KubeRoleBinding(chart, "delivery-job-controller-binding", {
    metadata: { name: "delivery-job-controller", namespace },
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
  const projectedItems = [
    {
      name: "dockerhub-pull-delivery-jobs",
      itemId: "ngzmppq52zm7sii6ato2mv3sbi",
    },
    { name: "delivery-worker-proofs", itemId: "w5y6wldczvojkh3yxe5zadkpvi" },
    { name: "delivery-root-release", itemId: "ga3ma76q6vw2bxeyvkqj4xaucy" },
    { name: "ci-seaweedfs-credentials", itemId: "eyfsbfkxojth6ymr65l47yyfxy" },
    { name: "ci-tailscale-credentials", itemId: "eoqdhvwgu7rjfqe6dknexihitu" },
    { name: "ci-github-credentials", itemId: "34gzcrhwdm34lpadyly3rcsu44" },
    { name: "ci-cloudflare-credentials", itemId: "djl2blalora2unjogqnsadlokq" },
  ];
  for (const { name, itemId } of projectedItems) {
    new OnePasswordItem(chart, `delivery-job-${name}`, {
      metadata: { name, namespace },
      ...(name === "dockerhub-pull-delivery-jobs"
        ? { type: "kubernetes.io/dockerconfigjson" }
        : {}),
      spec: { itemPath: vaultItemPath(itemId) },
    });
  }
  new KubeNetworkPolicy(chart, "delivery-stage-network", {
    metadata: { namespace },
    spec: {
      podSelector: { matchLabels: { app: "delivery-stage" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [
        dnsEgressRule(),
        externalHttpsEgressRule(),
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { app: "temporal-server" } },
            },
          ],
          ports: [{ protocol: "TCP", port: IntOrString.fromNumber(7233) }],
        },
      ],
    },
  });
  return account;
}
