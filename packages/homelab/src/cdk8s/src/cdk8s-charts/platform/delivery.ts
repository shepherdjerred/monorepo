import { Chart, Duration, Size, type App } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  PercentOrAbsolute,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createDeliveryNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/namespace.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import type { DeliveryActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";
import { createDeliveryNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/network-policy.ts";
import { createDeliveryMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/monitoring.ts";
import { deliveryForumEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/forum-bootstrap.ts";
import { deliveryTrmnlEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/trmnl-bootstrap.ts";
import { attachNativeForumReader } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/forum/native-reader.ts";
import { attachDeliveryRecoveryReaders } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/recovery-readers.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createDeliveryIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/ingress.ts";
import { DELIVERY_TAILSCALE_INGRESS } from "@shepherdjerred/ops-model/delivery-ingress.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { DELIVERY_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";

export function createDeliveryChart(
  app: App,
  activation: DeliveryActivation | undefined,
) {
  const chart = new Chart(app, "delivery", {
    namespace: "delivery",
    disableResourceNameHashes: true,
  });
  if (activation === undefined) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  const selectedImage =
    '{{ required `Delivery requires image` (get (.Values.delivery | default dict) "image") }}';
  // Under transition rendering the operator-run `delivery-data` chart owns the
  // Namespace and the `delivery-postgresql` cluster this chart connects to.
  if (!transitionRendering())
    createDeliveryNamespace(chart, { retained: false });
  const database = transitionRendering()
    ? singleAppDatabase(chart, { app: "delivery", provision: false })
    : singleAppDatabase(chart, {
        app: "delivery",
        provision: true,
        userFlags: [],
      });
  const item = new OnePasswordItem(chart, "bootstrap", {
    spec: { itemPath: vaultItemPath(activation.serviceItemId) },
  });
  const bootstrap = Secret.fromSecretName(chart, "bootstrap-secret", item.name);
  const ciItem = new OnePasswordItem(chart, "ci-reader", {
    spec: { itemPath: vaultItemPath("mjgnqqh37jxyzseqrddde2jgaq") },
  });
  const ciReader = Secret.fromSecretName(
    chart,
    "ci-reader-secret",
    ciItem.name,
  );
  const observerItem =
    activation.observerItemId === undefined
      ? undefined
      : new OnePasswordItem(chart, "argo-observer", {
          spec: { itemPath: vaultItemPath(activation.observerItemId) },
        });
  const githubItem =
    activation.githubReaderItemId === undefined
      ? undefined
      : new OnePasswordItem(chart, "github-reader", {
          spec: { itemPath: vaultItemPath(activation.githubReaderItemId) },
        });
  const deployment = new Deployment(chart, "delivery", {
    metadata: { labels: { app: "delivery" } },
    podMetadata: { labels: { app: "delivery" } },
    replicas: 1,
    // Executors journal native results through this API during its own release.
    strategy: DeploymentStrategy.rollingUpdate({
      maxSurge: PercentOrAbsolute.absolute(1),
      maxUnavailable: PercentOrAbsolute.absolute(0),
    }),
    // The outgoing API drains until proxies stop routing to it (at most 25s,
    // packages/delivery/src/server/drain.ts) before it stops serving.
    terminationGracePeriod: Duration.seconds(60),
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
  });
  const observer = createDeliveryIngressObserver(deployment);
  const dbEnv = database.env;
  const securityContext = {
    user: 1000,
    group: 1000,
    ensureNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    capabilities: { drop: [Capability.ALL] },
  };
  const mounts = [
    { path: "/tmp", volume: Volume.fromEmptyDir(chart, "tmp", "tmp") },
  ];
  deployment.addInitContainer(
    withCommonProps({
      name: "migrate",
      image: selectedImage,
      command: ["bun", "run", "migrate:deploy"],
      envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
      securityContext,
      volumeMounts: mounts,
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
    }),
  );
  deployment.addContainer(
    withCommonProps({
      name: "delivery",
      image: selectedImage,
      command: ["bun", "src/server/index.ts"],
      securityContext,
      volumeMounts: mounts,
      ports: [
        { name: DELIVERY_ENDPOINT.portName, number: DELIVERY_ENDPOINT.port },
      ],
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        // Measured working set steady-state 185-270Mi; 1024Mi gives headroom for SSE/publication bursts.
        memory: { request: Size.mebibytes(256), limit: Size.mebibytes(1024) },
      },
      startup: Probe.fromHttpGet("/healthz", {
        port: DELIVERY_ENDPOINT.port,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 18,
      }),
      readiness: Probe.fromHttpGet("/readyz", { port: DELIVERY_ENDPOINT.port }),
      liveness: Probe.fromHttpGet("/healthz", { port: DELIVERY_ENDPOINT.port }),
      envVariables: {
        ...dbEnv,
        ...deliveryForumEnvironment(chart, activation),
        ...deliveryTrmnlEnvironment(chart, activation),
        HOST: EnvValue.fromValue("0.0.0.0"),
        PORT: EnvValue.fromValue(String(DELIVERY_ENDPOINT.port)),
        HOME: EnvValue.fromValue("/tmp"),
        PUBLIC_ORIGIN: EnvValue.fromValue(tailnetService("delivery").origin),
        ENVIRONMENT: EnvValue.fromValue("production"),
        DELIVERY_MACHINE_CREDENTIALS: EnvValue.fromSecretValue({
          secret: bootstrap,
          key: "DELIVERY_MACHINE_CREDENTIALS",
        }),
        ...(observerItem === undefined
          ? {}
          : {
              ARGOCD_SERVER_URL: EnvValue.fromValue("https://argocd.sjer.red"),
              ARGOCD_RECOVERY_TOKEN: EnvValue.fromSecretValue({
                secret: Secret.fromSecretName(
                  chart,
                  "argo-observer-secret",
                  observerItem.name,
                ),
                key: "ARGOCD_RECOVERY_TOKEN",
              }),
            }),
        ...(githubItem === undefined
          ? {}
          : {
              DELIVERY_GH_TOKEN: EnvValue.fromSecretValue({
                secret: Secret.fromSecretName(
                  chart,
                  "github-reader-secret",
                  githubItem.name,
                ),
                key: "GITHUB_DOWNLOAD_TOKEN",
              }),
            }),
        WOODPECKER_URL: EnvValue.fromValue("https://woodpecker.sjer.red"),
        WOODPECKER_REPO_ID: EnvValue.fromValue("1"),
        WOODPECKER_TOKEN: EnvValue.fromSecretValue({
          secret: ciReader,
          key: "WOODPECKER_TOKEN",
        }),
        ...flagsEnv({ deployment: "delivery/prod" }),
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  attachDeliveryRecoveryReaders(deployment);
  if (
    activation.forumReaderItemId !== undefined &&
    activation.forumObserverItemId !== undefined
  )
    attachNativeForumReader(deployment, observer);
  const service = new Service(chart, "service", {
    metadata: { name: DELIVERY_ENDPOINT.service, labels: { app: "delivery" } },
    selector: deployment,
    ports: [{ name: DELIVERY_ENDPOINT.portName, port: DELIVERY_ENDPOINT.port }],
  });
  new TailscaleIngress(chart, "operator-ingress", {
    metadata: { name: DELIVERY_TAILSCALE_INGRESS.name },
    host: tailnetService("delivery"),
    service,
    port: DELIVERY_ENDPOINT.port,
    probePath: "/healthz",
  });
  createDeliveryNetworkPolicy(chart, database);
  createDeliveryMonitoring(chart);
  return chart;
}
