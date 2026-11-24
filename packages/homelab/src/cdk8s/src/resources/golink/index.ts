import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  DeploymentStrategy,
  EnvValue,
  type ISecret,
  Probe,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  FirstPartyWebService,
  type FirstPartyInitContainer,
  type FirstPartyServerContainer,
  type FirstPartySidecarContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  flagsEgress,
  kubernetesApiEgressRule,
  nsPeer,
  otlpEgress,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { tailnetTags } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import { createGolinkRbac, GOLINK_TAILSCALE_STATE_SECRET } from "./rbac.ts";
import { GOLINK_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";

export const GOLINK_FIRST_PARTY_ACTIVE = true;

const GOLINK_HTTP_PORT = GOLINK_ENDPOINT.port;
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

function buildTailscaleHandoverContainer(
  image: string,
  authSecret: ISecret,
  expectedHost: string,
  expectedFqdn: string,
): FirstPartyInitContainer {
  return {
    name: "tailscale-handover",
    image,
    command: ["bun", "src/server/handover-tailscale.ts"],
    securityContext: restrictedContainer(GOLINK_UID),
    resources: golinkContainerResources({
      cpuRequestMillis: 25,
      cpuLimitMillis: 250,
      memoryRequestMib: 64,
      memoryLimitMib: 256,
    }),
    envVariables: {
      HOME: EnvValue.fromValue("/tmp"),
      TS_STATE_SECRET_NAME: EnvValue.fromValue(GOLINK_TAILSCALE_STATE_SECRET),
      TS_EXPECTED_HOSTNAME: EnvValue.fromValue(expectedHost),
      TS_EXPECTED_FQDN: EnvValue.fromValue(expectedFqdn),
      TS_OAUTH_CLIENT_ID: EnvValue.fromSecretValue({
        secret: authSecret,
        key: "client_id",
      }),
      TS_OAUTH_CLIENT_SECRET: EnvValue.fromSecretValue({
        secret: authSecret,
        key: "client_secret",
      }),
    },
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
      ...flagsEnv({ deployment: "golink/prod" }),
      OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    },
  };
}

function buildTailscaleSidecarContainer(
  authSecret: ISecret,
  expectedHost: string,
  tags: string,
): FirstPartySidecarContainer {
  const oauthSecretRef = ["$(TS_OAUTH_CLIENT_", "SECRET)"].join("");
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
      TS_AUTH_ONCE: EnvValue.fromValue("true"),
      TS_HOSTNAME: EnvValue.fromValue(expectedHost),
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
      TS_OAUTH_CLIENT_SECRET: EnvValue.fromSecretValue({
        secret: authSecret,
        key: "client_secret",
      }),
      TS_AUTHKEY: EnvValue.fromValue(
        `${oauthSecretRef}?ephemeral=false&preauthorized=true`,
      ),
    },
  };
}

export function createFirstPartyGolinkDeployment(
  chart: Chart,
  image: string,
  database: SingleAppDatabase,
) {
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
  const dbEnv = database.env;
  const goTailnet = tailnetService("go");
  const tags = tailnetTags(goTailnet);

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
    containers: () => {
      const authItem = new OnePasswordItem(
        chart,
        "tailscale-auth-key-onepassword",
        {
          spec: { itemPath: vaultItemPath("mboftvs4fyptyqvg3anrfjy6vu") },
          metadata: { name: "tailscale-auth-key" },
        },
      );
      const authSecret = Secret.fromSecretName(
        chart,
        "tailscale-auth-key",
        authItem.name,
      );
      return {
        init: [
          buildGolinkMigrateContainer(image, dbEnv),
          buildTailscaleHandoverContainer(
            image,
            authSecret,
            goTailnet.host,
            goTailnet.fqdn,
          ),
        ],
        server: buildGolinkServerContainer(image, dbEnv),
        sidecars: [
          buildTailscaleSidecarContainer(authSecret, goTailnet.host, tags),
        ],
      };
    },
    serviceName: "golink",
    policies: [
      {
        // Keep the existing resource name so non-pruning ArgoCD / Delivery
        // syncs update the legacy namespace-wide golink-netpol in place to
        // select only app=golink pods instead of isolating golink-postgresql.
        name: "golink-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([GOLINK_HTTP_PORT]),
          {
            from: [
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "infra-worker" } },
              },
            ],
            ports: [tcp(GOLINK_HTTP_PORT)],
          },
        ],
        egress: [
          dnsEgressRule(),
          database.egress,
          flagsEgress(),
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

  database.createClusterIngressPolicy(
    "golink-postgresql-netpol",
    { app: "golink" },
    { name: "golink-postgresql-netpol" },
  );

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
