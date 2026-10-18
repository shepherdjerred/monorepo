import { Chart, Duration, Size, type App } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Namespace,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import type { DeliveryActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";
import { createDeliveryNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/network-policy.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createDeliveryMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/monitoring.ts";
import { deliveryForumEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/forum-bootstrap.ts";
import { deliveryTrmnlEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/trmnl-bootstrap.ts";
import { createDeliveryCatalogRecovery } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/catalog-recovery.ts";
import { attachNativeForumReader } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/forum/native-reader.ts";

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
  if (
    !/^docker\.io\/shepherdjerred\/delivery@sha256:[a-f0-9]{64}$/u.test(
      activation.image,
    )
  )
    throw new Error("Delivery requires a published image digest");
  const selectedImage = `{{ .Values.delivery.image | default "${activation.image}" }}`;
  new Namespace(chart, "namespace", { metadata: { name: "delivery" } });
  createDeliveryCatalogRecovery(chart);
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
  const tailnetItem = new OnePasswordItem(chart, "tailnet-identity", {
    spec: { itemPath: vaultItemPath(activation.tailscaleItemId) },
  });
  const tailnetSecret = Secret.fromSecretName(
    chart,
    "tailnet-secret",
    tailnetItem.name,
  );
  const observerItem =
    activation.observerItemId === undefined
      ? undefined
      : new OnePasswordItem(chart, "argo-observer", {
          spec: { itemPath: vaultItemPath(activation.observerItemId) },
        });
  const deployment = new Deployment(chart, "delivery", {
    metadata: { labels: { app: "delivery" } },
    podMetadata: { labels: { app: "delivery" } },
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
  });
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
    attachNativeForumReader(deployment);
  const serveConfig = new ConfigMap(chart, "tailnet-serve", {
    data: {
      "serve.json": JSON.stringify({
        TCP: { "443": { HTTPS: true } },
        Web: {
          "${TS_CERT_DOMAIN}:443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:7353" } },
          },
        },
        AllowFunnel: {},
      }),
    },
  });
  const state = new ZfsNvmeVolume(chart, "delivery-tailnet-state", {
    storage: Size.gibibytes(1),
  });
  // Serve terminates authenticated tailnet TLS inside this Pod and connects
  // over loopback. There is no cluster-accessible identity-trusting listener;
  // this boundary remains enforced even when the CNI ignores NetworkPolicy.
  deployment.addContainer(
    withCommonProps({
      name: "tailscale",
      image: `docker.io/tailscale/tailscale:${versions["tailscale/tailscale"]}`,
      securityContext,
      envVariables: {
        TS_AUTHKEY: EnvValue.fromSecretValue({
          secret: tailnetSecret,
          key: "TS_AUTHKEY",
        }),
        TS_USERSPACE: EnvValue.fromValue("true"),
        TS_KUBE_SECRET: EnvValue.fromValue(""),
        TS_STATE_DIR: EnvValue.fromValue("/var/lib/tailscale"),
        TS_SOCKET: EnvValue.fromValue("/var/run/tailscale/tailscaled.sock"),
        TS_AUTH_ONCE: EnvValue.fromValue("true"),
        TS_HOSTNAME: EnvValue.fromValue("delivery"),
        TS_EXTRA_ARGS: EnvValue.fromValue("--advertise-tags=tag:delivery"),
        TS_SERVE_CONFIG: EnvValue.fromValue("/etc/tailscale/serve.json"),
        TS_ENABLE_HEALTH_CHECK: EnvValue.fromValue("true"),
        TS_LOCAL_ADDR_PORT: EnvValue.fromValue("0.0.0.0:9002"),
      },
      volumeMounts: [
        {
          path: "/etc/tailscale",
          volume: Volume.fromConfigMap(chart, "serve-config", serveConfig),
        },
        {
          path: "/var/lib/tailscale",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "tailnet-state",
            state.claim,
          ),
        },
        {
          path: "/tmp",
          volume: Volume.fromEmptyDir(chart, "tailnet-tmp", "tailnet-tmp"),
        },
        {
          path: "/var/run/tailscale",
          volume: Volume.fromEmptyDir(
            chart,
            "tailnet-socket",
            "tailnet-socket",
          ),
        },
      ],
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
      },
      readiness: Probe.fromHttpGet("/healthz", { port: 9002 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 9002 }),
    }),
  );
  new Service(chart, "service", {
    metadata: { name: "delivery", labels: { app: "delivery" } },
    selector: deployment,
    ports: [{ name: "http", port: 7353 }],
  });
  createDeliveryNetworkPolicy(chart);
  createDeliveryMonitoring(chart);
  return chart;
}
