import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  fliptEgress,
  kubernetesApiEgressRule,
  otlpEgress,
  postgresEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export const GOLINK_FIRST_PARTY_ACTIVE = false;

function databaseUrl() {
  const protocol = "postgresql";
  const user = "$(DB_USER)";
  const password = "$(DB_" + "PASSWORD)";
  return `${protocol}://${user}:${password}@golink-postgresql:5432/golink_db`;
}

/** Prepared first-party golink workload; Stage 1 keeps live golink on upstream until its image is published. */
export function createFirstPartyGolinkDeployment(chart: Chart, image: string) {
  if (
    image !== "docker.io/shepherdjerred/golink:delivery-recipe" &&
    !/^docker\.io\/shepherdjerred\/golink@sha256:[a-f0-9]{64}$/u.test(image)
  ) {
    throw new Error("Golink requires a pinned public image digest");
  }
  const pg = Secret.fromSecretName(
    chart,
    "golink-pg",
    "golink.golink-postgresql.credentials.postgresql.acid.zalan.do",
  );
  const dbEnv = {
    DB_USER: EnvValue.fromSecretValue({ secret: pg, key: "username" }),
    DB_PASSWORD: EnvValue.fromSecretValue({ secret: pg, key: "password" }),
    DATABASE_URL: EnvValue.fromValue(databaseUrl()),
  };
  const securityContext = restrictedContainer(1000);
  return new FirstPartyWebService(chart, "golink-web-service", {
    name: "golink",
    port: 7352,
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: "golink" } },
      strategy: DeploymentStrategy.recreate(),
      securityContext: { fsGroup: 1000 },
    },
    containers: () => ({
      init: [
        {
          name: "prisma-migrate",
          image,
          command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
          securityContext,
          resources: {
            cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
            memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
          },
          envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
        },
      ],
      server: {
        image,
        command: ["bun", "src/server/index.ts"],
        securityContext,
        resources: {
          cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
          memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
        },
        envVariables: {
          ...dbEnv,
          HOME: EnvValue.fromValue("/tmp"),
          HOST: EnvValue.fromValue("0.0.0.0"),
          PORT: EnvValue.fromValue("7352"),
          ENVIRONMENT: EnvValue.fromValue("production"),
          ...fliptEnv({ namespace: "golink", environment: "prod" }),
          OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(
            OTLP_GATEWAY_BASE_URL,
          ),
        },
      },
    }),
    serviceName: "golink",
    policies: [
      {
        name: "golink-app-netpol",
        selects: "app",
        ingress: [prometheusIngressRule([7352])],
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
