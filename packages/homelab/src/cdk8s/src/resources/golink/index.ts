import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  FirstPartyWebService,
  type FirstPartyInitContainer,
  type FirstPartyServerContainer,
  type FirstPartySidecarContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  fliptEgress,
  kubernetesApiEgressRule,
  otlpEgress,
  postgresEgress,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { tailnetTags } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import { createGolinkRbac, GOLINK_TAILSCALE_STATE_SECRET } from "./rbac.ts";

export const GOLINK_FIRST_PARTY_ACTIVE = true;

const GOLINK_HTTP_PORT = 7352;
const TAILSCALE_HEALTH_PORT = 9002;
const GOLINK_UID = 1000;
const PINNED_GOLINK_IMAGE_PATTERN =
  /^docker\.io\/shepherdjerred\/golink@sha256:[a-f0-9]{64}$/u;

const CURATED_MANUAL_SEED_JSON = JSON.stringify([
  { short: "gh", targetUrl: "https://github.com/shepherdjerred/" },
  { short: "ha", targetUrl: "https://homeassistant.tailnet-1a49.ts.net/" },
  { short: "temporal", targetUrl: "https://temporal-ui.tailnet-1a49.ts.net/" },
  { short: "ts", targetUrl: "https://login.tailscale.com/admin/machines" },
]);

const TAILSCALE_SERVE_CONFIG_JSON = JSON.stringify(
  {
    TCP: {
      "80": { HTTP: true },
      "443": { HTTPS: true },
    },
    Web: {
      "${TS_CERT_DOMAIN}:80": {
        Handlers: {
          "/": { Proxy: `http://127.0.0.1:${String(GOLINK_HTTP_PORT)}` },
        },
      },
      "${TS_CERT_DOMAIN}:443": {
        Handlers: {
          "/": { Proxy: `http://127.0.0.1:${String(GOLINK_HTTP_PORT)}` },
        },
      },
    },
  },
  null,
  2,
);

function golinkDatabaseUrl(): string {
  const credentialRef = ["$(DB_USER)", "$(DB_" + "PASSWORD)"].join(":");
  return `postgresql://${credentialRef}@golink-postgresql:5432/golink_db`;
}

function buildGolinkDatabaseEnv(chart: Chart): Record<string, EnvValue> {
  const credentialsSecret = Secret.fromSecretName(
    chart,
    "golink-pg",
    "golink.golink-postgresql.credentials.postgresql.acid.zalan.do",
  );
  return {
    DB_USER: EnvValue.fromSecretValue({
      secret: credentialsSecret,
      key: "username",
    }),
    DB_PASSWORD: EnvValue.fromSecretValue({
      secret: credentialsSecret,
      key: "password",
    }),
    DATABASE_URL: EnvValue.fromValue(golinkDatabaseUrl()),
  };
}

function golinkContainerResources(spec: {
  readonly cpuRequestMillis: number;
  readonly cpuLimitMillis: number;
  readonly memoryRequestMib: number;
  readonly memoryLimitMib: number;
}) {
  return {
    cpu: {
      request: Cpu.millis(spec.cpuRequestMillis),
      limit: Cpu.millis(spec.cpuLimitMillis),
    },
    memory: {
      request: Size.mebibytes(spec.memoryRequestMib),
      limit: Size.mebibytes(spec.memoryLimitMib),
    },
  };
}

function buildGolinkMigrateContainer(
  image: string,
  dbEnv: Record<string, EnvValue>,
): FirstPartyInitContainer {
  return {
    name: "prisma-migrate",
    image,
    command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
    securityContext: restrictedContainer(GOLINK_UID),
    resources: golinkContainerResources({
      cpuRequestMillis: 25,
      cpuLimitMillis: 250,
      memoryRequestMib: 64,
      memoryLimitMib: 256,
    }),
    envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
  };
}

function buildGolinkServerContainer(
  image: string,
  dbEnv: Record<string, EnvValue>,
): FirstPartyServerContainer {
  return {
    image,
    command: ["bun", "src/server/index.ts"],
    securityContext: restrictedContainer(GOLINK_UID),
    resources: golinkContainerResources({
      cpuRequestMillis: 50,
      cpuLimitMillis: 500,
      memoryRequestMib: 128,
      memoryLimitMib: 512,
    }),
    envVariables: {
      ...dbEnv,
      HOME: EnvValue.fromValue("/tmp"),
      HOST: EnvValue.fromValue("0.0.0.0"),
      PORT: EnvValue.fromValue(String(GOLINK_HTTP_PORT)),
      ENVIRONMENT: EnvValue.fromValue("production"),
      GOLINK_SEED_JSON: EnvValue.fromValue(CURATED_MANUAL_SEED_JSON),
      ...fliptEnv({ namespace: "golink", environment: "prod" }),
      OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    },
  };
}

function buildTailscaleSidecarContainer(
  chart: Chart,
): FirstPartySidecarContainer {
  const authItem = new OnePasswordItem(
    chart,
    "tailscale-auth-key-onepassword",
    {
      spec: { itemPath: vaultItemPath("mboftvs4fyptyqvg3anrfjy6vu") },
      metadata: { name: "tailscale-auth-key" },
    },
  );
  const tags = tailnetTags(tailnetService("go"));
  return {
    name: "tailscale",
    image: `ghcr.io/tailscale/tailscale:${versions["tailscale/tailscale"]}`,
    securityContext: restrictedContainer(GOLINK_UID),
    resources: golinkContainerResources({
      cpuRequestMillis: 25,
      cpuLimitMillis: 250,
      memoryRequestMib: 64,
      memoryLimitMib: 256,
    }),
    ports: [{ name: "ts-health", number: TAILSCALE_HEALTH_PORT }],
    startup: Probe.fromHttpGet("/healthz", {
      port: TAILSCALE_HEALTH_PORT,
      periodSeconds: Duration.seconds(5),
      failureThreshold: 36,
    }),
    readiness: Probe.fromHttpGet("/healthz", {
      port: TAILSCALE_HEALTH_PORT,
      periodSeconds: Duration.seconds(10),
      failureThreshold: 3,
    }),
    envVariables: {
      HOME: EnvValue.fromValue("/tmp"),
      XDG_CACHE_HOME: EnvValue.fromValue("/tmp"),
      TS_USERSPACE: EnvValue.fromValue("true"),
      TS_HOSTNAME: EnvValue.fromValue("go"),
      TS_KUBE_SECRET: EnvValue.fromValue(GOLINK_TAILSCALE_STATE_SECRET),
      TS_SOCKET: EnvValue.fromValue("/tmp/tailscaled.sock"),
      TS_STATE_DIR: EnvValue.fromValue("/tmp/ts-state"),
      TS_SERVE_CONFIG: EnvValue.fromValue("/etc/tailscale/serve.json"),
      TS_ADVERTISE_TAGS: EnvValue.fromValue(tags),
      TS_EXTRA_ARGS: EnvValue.fromValue(`--advertise-tags=${tags}`),
      TS_ENABLE_HEALTH_CHECK: EnvValue.fromValue("true"),
      TS_LOCAL_ADDR_PORT: EnvValue.fromValue(
        `0.0.0.0:${String(TAILSCALE_HEALTH_PORT)}`,
      ),
      TS_AUTHKEY: EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(
          chart,
          "tailscale-auth-key",
          authItem.name,
        ),
        key: "client_secret",
      }),
    },
  };
}

export function createFirstPartyGolinkDeployment(chart: Chart, image: string) {
  if (
    image !== "docker.io/shepherdjerred/golink:delivery-recipe" &&
    !PINNED_GOLINK_IMAGE_PATTERN.test(image)
  ) {
    throw new Error("Golink requires a pinned public image digest");
  }
  const serviceAccount = createGolinkRbac(chart);
  const serveConfig = new ConfigMap(chart, "golink-tailscale-serve", {
    metadata: { name: "golink-tailscale-serve" },
    data: { "serve.json": TAILSCALE_SERVE_CONFIG_JSON },
  });
  const dbEnv = buildGolinkDatabaseEnv(chart);

  const webService = new FirstPartyWebService(chart, "golink-web-service", {
    name: "golink",
    port: GOLINK_HTTP_PORT,
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: "golink" } },
      strategy: DeploymentStrategy.recreate(),
      securityContext: { fsGroup: GOLINK_UID },
      serviceAccount,
      automountServiceAccountToken: true,
    },
    containers: () => ({
      init: [buildGolinkMigrateContainer(image, dbEnv)],
      server: buildGolinkServerContainer(image, dbEnv),
      sidecars: [buildTailscaleSidecarContainer(chart)],
    }),
    serviceName: "golink",
    policies: [
      {
        name: "golink-app-netpol",
        selects: "app",
        ingress: [prometheusIngressRule([GOLINK_HTTP_PORT])],
        egress: [
          dnsEgressRule(),
          postgresEgress("golink-postgresql"),
          fliptEgress(),
          otlpEgress(),
          kubernetesApiEgressRule(),
          externalHttpsEgressRule(),
          { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [tcp(80)] },
          {
            to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
            ports: [{ protocol: "UDP" }],
          },
        ],
      },
    ],
  });

  const tailscaleContainer = webService.deployment.containers.find(
    (container) => container.name === "tailscale",
  );
  if (tailscaleContainer === undefined) {
    throw new Error(
      "Expected tailscale sidecar container on golink Deployment",
    );
  }
  tailscaleContainer.mount(
    "/etc/tailscale",
    Volume.fromConfigMap(chart, "golink-tailscale-serve-vol", serveConfig),
    { readOnly: true },
  );

  return webService;
}
