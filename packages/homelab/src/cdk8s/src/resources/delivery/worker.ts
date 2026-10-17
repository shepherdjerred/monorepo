import { Size, type Chart } from "cdk8s";
import { Cpu, EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { createTemporalDomainWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/domain-worker.ts";
import type { DeliveryExecutorActivation } from "./activation.ts";

const tcp = (port: number) => ({
  port: IntOrString.fromNumber(port),
  protocol: "TCP",
});
const ns = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});

export function createDeliveryWorker(
  chart: Chart,
  activation: DeliveryExecutorActivation,
  serverServiceName: string,
) {
  const item = new OnePasswordItem(chart, "delivery-executor", {
    spec: { itemPath: vaultItemPath(activation.executorItemId) },
  });
  const secret = Secret.fromSecretName(
    chart,
    "delivery-executor-secret",
    item.name,
  );
  const argoItem = new OnePasswordItem(chart, "delivery-argocd", {
    spec: { itemPath: vaultItemPath(activation.argocdItemId) },
  });
  const argoSecret = Secret.fromSecretName(
    chart,
    "delivery-argocd-secret",
    argoItem.name,
  );
  const deployment = createTemporalDomainWorker(chart, {
    name: "temporal-delivery-worker",
    component: "delivery-worker",
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.gibibytes(1),
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("delivery"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      DELIVERY_API_URL: EnvValue.fromValue(
        "http://delivery.delivery.svc.cluster.local:7353",
      ),
      DELIVERY_EXECUTOR_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "DELIVERY_EXECUTOR_TOKEN",
      }),
      ARGOCD_SERVER_URL: EnvValue.fromValue("https://argocd.sjer.red"),
      ARGOCD_TOKEN: EnvValue.fromSecretValue({
        secret: argoSecret,
        key: "ARGOCD_TOKEN",
      }),
    },
  });
  new KubeNetworkPolicy(chart, "delivery-worker-network", {
    spec: {
      podSelector: { matchLabels: { component: "delivery-worker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [ns("prometheus")], ports: [tcp(9464), tcp(9465)] }],
      egress: [
        dnsEgressRule(),
        externalHttpsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: [tcp(7233)],
        },
        { to: [ns("delivery")], ports: [tcp(7353)] },
        { to: [ns("flipt")], ports: [tcp(8080)] },
      ],
    },
  });
  return deployment;
}
