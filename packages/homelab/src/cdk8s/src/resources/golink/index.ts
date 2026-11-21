import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  FirstPartyWebService,
  type FirstPartyInitContainer,
  type FirstPartyServerContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  fliptEgress,
  kubernetesApiEgressRule,
  otlpEgress,
  postgresEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export const GOLINK_FIRST_PARTY_ACTIVE = false;

const GOLINK_HTTP_PORT = 7352;
const GOLINK_UID = 1000;
const PINNED_GOLINK_IMAGE_PATTERN =
  /^docker\.io\/shepherdjerred\/golink@sha256:[a-f0-9]{64}$/u;

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
  const serverEnv: Record<string, EnvValue> = {
    ...dbEnv,
    HOME: EnvValue.fromValue("/tmp"),
    HOST: EnvValue.fromValue("0.0.0.0"),
    PORT: EnvValue.fromValue(String(GOLINK_HTTP_PORT)),
    ENVIRONMENT: EnvValue.fromValue("production"),
    ...fliptEnv({ namespace: "golink", environment: "prod" }),
    OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
  };
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
    envVariables: serverEnv,
  };
}

/** Prepared first-party golink workload; Stage 1 keeps live golink on upstream until its image is published. */
export function createFirstPartyGolinkDeployment(chart: Chart, image: string) {
  if (
    image !== "docker.io/shepherdjerred/golink:delivery-recipe" &&
    !PINNED_GOLINK_IMAGE_PATTERN.test(image)
  ) {
    throw new Error("Golink requires a pinned public image digest");
  }
  const dbEnv = buildGolinkDatabaseEnv(chart);
  return new FirstPartyWebService(chart, "golink-web-service", {
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
    },
    containers: () => ({
      init: [buildGolinkMigrateContainer(image, dbEnv)],
      server: buildGolinkServerContainer(image, dbEnv),
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
        ],
      },
    ],
  });
}
