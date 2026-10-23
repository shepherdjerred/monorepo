import { Chart, Duration, Size, type App } from "cdk8s";
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
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
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
import { createDeliveryCatalogRecovery } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/catalog-recovery.ts";
import { attachNativeForumReader } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/forum/native-reader.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createDeliveryIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/ingress.ts";
import { DELIVERY_TAILSCALE_INGRESS } from "@shepherdjerred/ops-model/delivery-ingress.ts";

function databaseUrl() {
  const protocol = "postgresql";
  const username = "$(DB_USER)";
  const password = "$(DB_" + "PASSWORD)";
  return `${protocol}://${username}:${password}@delivery-postgresql:5432/delivery_db`;
}

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
  createDeliveryCatalogRecovery(chart);
  if (!transitionRendering())
    createSingleAppPostgreSQL(chart, { app: "delivery", userFlags: [] });
  const database = Secret.fromSecretName(
    chart,
    "postgres",
    "delivery.delivery-postgresql.credentials.postgresql.acid.zalan.do",
  );
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
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
  });
  const observer = createDeliveryIngressObserver(deployment);
  const dbEnv = {
    DB_USER: EnvValue.fromSecretValue({ secret: database, key: "username" }),
    DB_PASSWORD: EnvValue.fromSecretValue({
      secret: database,
      key: "password",
    }),
    DATABASE_URL: EnvValue.fromValue(databaseUrl()),
  };
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
      ports: [{ name: "http", number: 7353 }],
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
      startup: Probe.fromHttpGet("/healthz", {
        port: 7353,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 18,
      }),
      readiness: Probe.fromHttpGet("/readyz", { port: 7353 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 7353 }),
      envVariables: {
        ...dbEnv,
        ...deliveryForumEnvironment(chart, activation),
        ...deliveryTrmnlEnvironment(chart, activation),
        HOST: EnvValue.fromValue("0.0.0.0"),
        PORT: EnvValue.fromValue("7353"),
        HOME: EnvValue.fromValue("/tmp"),
        PUBLIC_ORIGIN: EnvValue.fromValue(
          "https://delivery.tailnet-1a49.ts.net",
        ),
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
                key: "DELIVERY_GH_TOKEN",
              }),
            }),
        WOODPECKER_URL: EnvValue.fromValue("https://woodpecker.sjer.red"),
        WOODPECKER_REPO_ID: EnvValue.fromValue("1"),
        WOODPECKER_TOKEN: EnvValue.fromSecretValue({
          secret: ciReader,
          key: "WOODPECKER_TOKEN",
        }),
        FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
        FLIPT_NAMESPACE: EnvValue.fromValue("delivery"),
        FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
        FLIPT_URL: EnvValue.fromValue(
          "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
        ),
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  if (
    activation.forumReaderItemId !== undefined &&
    activation.forumObserverItemId !== undefined
  )
    attachNativeForumReader(deployment, observer);
  const service = new Service(chart, "service", {
    metadata: { name: "delivery", labels: { app: "delivery" } },
    selector: deployment,
    ports: [{ name: "http", port: 7353 }],
  });
  new TailscaleIngress(chart, "operator-ingress", {
    metadata: {
      name: DELIVERY_TAILSCALE_INGRESS.name,
      annotations: { "tailscale.com/tags": "tag:delivery" },
    },
    host: "delivery",
    service,
    port: 7353,
    probePath: "/healthz",
  });
  createDeliveryNetworkPolicy(chart);
  createDeliveryMonitoring(chart);
  return chart;
}
