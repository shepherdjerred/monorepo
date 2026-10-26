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
  kubernetesApiEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { PROMETHEUS_GATEWAY_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import { createTemporalDomainWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/domain-worker.ts";
import type { DeliveryExecutorActivation } from "./activation.ts";
import { createDeliveryJobs } from "./jobs.ts";
import { createDeliveryPlatformWorker } from "./platform-worker.ts";
import { deliveryTrmnlEnvironment } from "./trmnl-bootstrap.ts";

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
  if (
    (activation.platformRegistryItemId === undefined) !==
    (activation.platformArgocdItemId === undefined)
  )
    throw new Error(
      "Platform capability requires its issued dedicated ArgoCD and registry item pair",
    );
  if (
    activation.platformRegistryItemId !== undefined &&
    activation.platformArgocdItemId !== undefined
  )
    createDeliveryPlatformWorker(
      chart,
      {
        executorItemId: activation.executorItemId,
        registryItemId: activation.platformRegistryItemId,
        argocdItemId: activation.platformArgocdItemId,
      },
      serverServiceName,
    );
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
  const staticStorageEnvironment: Record<string, EnvValue> = {};
  const channelEnvironment: Record<string, EnvValue> = {};
  const registryEnvironment: Record<string, EnvValue> = {};
  if (activation.workerRegistryItemId !== undefined) {
    const registryItem = new OnePasswordItem(
      chart,
      "delivery-runtime-registry",
      {
        type: "kubernetes.io/dockerconfigjson",
        spec: { itemPath: vaultItemPath(activation.workerRegistryItemId) },
      },
    );
    registryEnvironment["DOCKERHUB_READ_CONFIG_JSON"] =
      EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(
          chart,
          "delivery-runtime-registry-secret",
          registryItem.name,
        ),
        key: ".dockerconfigjson",
      });
  }
  if (activation.staticStorageItemId !== undefined) {
    const staticItem = new OnePasswordItem(chart, "delivery-static-storage", {
      spec: { itemPath: vaultItemPath(activation.staticStorageItemId) },
    });
    const staticSecret = Secret.fromSecretName(
      chart,
      "delivery-static-storage-secret",
      staticItem.name,
    );
    for (const key of [
      "DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID",
      "DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY",
    ])
      staticStorageEnvironment[key] = EnvValue.fromSecretValue({
        secret: staticSecret,
        key,
      });
  }
  if (activation.npmChannelItemId !== undefined) {
    // npm channels publish and move dist-tags with their own token (X12).
    const npmItem = new OnePasswordItem(chart, "delivery-npm-channel", {
      spec: { itemPath: vaultItemPath(activation.npmChannelItemId) },
    });
    channelEnvironment["NPM_TOKEN"] = EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "delivery-npm-channel-secret",
        npmItem.name,
      ),
      key: "NPM_TOKEN",
    });
  }
  if (activation.staticCacheItemId !== undefined) {
    const cacheItem = new OnePasswordItem(chart, "delivery-static-cache", {
      spec: { itemPath: vaultItemPath(activation.staticCacheItemId) },
    });
    const cacheSecret = Secret.fromSecretName(
      chart,
      "delivery-static-cache-secret",
      cacheItem.name,
    );
    staticStorageEnvironment["CLOUDFLARE_API_TOKEN"] = EnvValue.fromSecretValue(
      {
        secret: cacheSecret,
        key: "credential",
      },
    );
  }
  const deployment = createTemporalDomainWorker(chart, {
    name: "temporal-delivery-worker",
    deploymentName: "temporal-delivery-worker",
    component: "delivery-worker",
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.gibibytes(1),
    ...(activation.workerRegistryItemId === undefined
      ? {}
      : {
          serviceAccount: createDeliveryJobs(
            chart,
            "worker",
            activation.workerRegistryItemId,
          ),
          automountServiceAccountToken: true,
        }),
    envVariables: {
      ...deliveryTrmnlEnvironment(chart, activation),
      ...staticStorageEnvironment,
      ...channelEnvironment,
      ...registryEnvironment,
      ...(activation.workerRegistryItemId === undefined
        ? {}
        : {
            NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
              "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
            ),
          }),
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
        ...(activation.workerRegistryItemId === undefined
          ? []
          : [{ ports: [tcp(443)] }, kubernetesApiEgressRule()]),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: [tcp(7233)],
        },
        { to: [ns("delivery")], ports: [tcp(7353)] },
        { to: [ns("flipt")], ports: [tcp(8080)] },
        // Worker poller proofs query Prometheus. NetworkPolicy matches the pod
        // port, the authenticated gateway's, not the Service's 9090.
        { to: [ns("prometheus")], ports: [tcp(PROMETHEUS_GATEWAY_PORT)] },
      ],
    },
  });
  return deployment;
}
