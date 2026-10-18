import { Size, type Chart } from "cdk8s";
import { Cpu, EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  dnsEgressRule,
  kubernetesApiEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { createTemporalDomainWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/domain-worker.ts";
import { createDeliveryJobs } from "./jobs.ts";
const namespace = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});
const ports = (...numbers: number[]) =>
  numbers.map((port) => ({
    port: IntOrString.fromNumber(port),
    protocol: "TCP",
  }));

/** No ordinary worker queue or worker Job capability shares this provider-bearing account. */
export function createDeliveryPlatformWorker(
  chart: Chart,
  items: {
    executorItemId: string;
    registryItemId: string;
    argocdItemId: string;
  },
  serverServiceName: string,
) {
  const account = createDeliveryJobs(
    chart,
    "platform",
    items.registryItemId,
    items.argocdItemId,
  );
  const item = new OnePasswordItem(chart, "delivery-platform-executor", {
    spec: { itemPath: vaultItemPath(items.executorItemId) },
  });
  const secret = Secret.fromSecretName(
    chart,
    "delivery-platform-executor-secret",
    item.name,
  );
  const deployment = createTemporalDomainWorker(chart, {
    name: "temporal-delivery-platform-worker",
    deploymentName: "temporal-delivery-platform-worker",
    component: "delivery-platform-worker",
    serviceAccount: account,
    automountServiceAccountToken: true,
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.gibibytes(1),
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("delivery-platform"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      DELIVERY_API_URL: EnvValue.fromValue(
        "http://delivery.delivery.svc.cluster.local:7353",
      ),
      DELIVERY_EXECUTOR_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "DELIVERY_EXECUTOR_TOKEN",
      }),
    },
  });
  new KubeNetworkPolicy(chart, "delivery-platform-worker-network", {
    spec: {
      podSelector: { matchLabels: { component: "delivery-platform-worker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [namespace("prometheus")], ports: ports(9464, 9465) }],
      egress: [
        dnsEgressRule(),
        { ports: ports(443) },
        kubernetesApiEgressRule(),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: ports(7233),
        },
        { to: [namespace("delivery")], ports: ports(7353) },
        { to: [namespace("flipt")], ports: ports(8080) },
      ],
    },
  });
  return deployment;
}
