import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  type ISecret,
  Pods,
  Secret,
  Service,
} from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  ERRORS_ADMIN_ENDPOINT,
  ERRORS_INGEST_ENDPOINT,
  MAIL_API_ENDPOINT,
  TRACKER_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  FirstPartyWebService,
  type FirstPartyInitContainer,
  type FirstPartyServerContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  blackboxProbeIngressRule,
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  flagsEgress,
  nsPeer,
  otlpEgress,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const ERRORS_ACTIVE = true;

const ERRORS_UID = 1000;
const ERRORS_ITEM_ID = "mwo5qddujbhavrelnkkymoe3ke";

function buildErrorsMigrateContainer(
  dbEnv: Record<string, EnvValue>,
): FirstPartyInitContainer {
  return {
    name: "prisma-migrate",
    image: firstPartyImageRecipe("errors"),
    command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
    securityContext: restrictedContainer(ERRORS_UID),
    resources: {
      cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
      memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
    },
    envVariables: {
      ...dbEnv,
      HOME: EnvValue.fromValue("/tmp"),
    },
  };
}

function buildErrorsServerContainer(
  dbEnv: Record<string, EnvValue>,
  authSecret: ISecret,
  consolePublicOrigin: string,
): FirstPartyServerContainer {
  const envVariables: Record<string, EnvValue> = {
    ...dbEnv,
    ...flagsEnv({ deployment: "errors/prod" }),
    ERRORS_INGEST_PORT: EnvValue.fromValue(String(ERRORS_INGEST_ENDPOINT.port)),
    PUBLIC_INGEST_ORIGIN: EnvValue.fromValue("https://logging.sjer.red"),
    CONSOLE_PUBLIC_ORIGIN: EnvValue.fromValue(consolePublicOrigin),
    TRACKER_API_URL: EnvValue.fromValue(TRACKER_ENDPOINT.url),
    TRACKER_PUBLIC_URL: EnvValue.fromValue(
      "https://tracker.tailnet-1a49.ts.net",
    ),
    MAIL_API_URL: EnvValue.fromValue(MAIL_API_ENDPOINT.url),
    MAIL_FROM: EnvValue.fromValue("Errors <errors@sjer.red>"),
    MAIL_TO: EnvValue.fromValue("alerts@sjer.red"),
    BUGSINK_IMPORT_URL: EnvValue.fromValue(
      "http://bugsink-bugsink-service.bugsink.svc.cluster.local:8000",
    ),
    ERRORS_MACHINE_TOKEN: EnvValue.fromSecretValue({
      secret: authSecret,
      key: "ERRORS_MACHINE_TOKEN",
    }),
    MAIL_API_TOKEN: EnvValue.fromSecretValue({
      secret: authSecret,
      key: "MAIL_API_TOKEN",
    }),
    BUGSINK_IMPORT_TOKEN: EnvValue.fromSecretValue({
      secret: authSecret,
      key: "BUGSINK_IMPORT_TOKEN",
    }),
    OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    ENVIRONMENT: EnvValue.fromValue("production"),
    HOST: EnvValue.fromValue("0.0.0.0"),
    PORT: EnvValue.fromValue(String(ERRORS_ADMIN_ENDPOINT.port)),
    HOME: EnvValue.fromValue("/tmp"),
  };
  return {
    image: firstPartyImageRecipe("errors"),
    securityContext: restrictedContainer(ERRORS_UID),
    envVariables,
    resources: {
      cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
      memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
    },
  };
}

export function createErrorsDeployment(
  chart: Chart,
  database: SingleAppDatabase,
) {
  const errorsTailnet = tailnetService("errors");
  const webService = new FirstPartyWebService(chart, "errors-web-service", {
    name: ERRORS_ADMIN_ENDPOINT.app,
    port: ERRORS_ADMIN_ENDPOINT.port,
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: ERRORS_ADMIN_ENDPOINT.app } },
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: { fsGroup: ERRORS_UID },
    },
    containers: () => {
      const authItem = onePasswordSecret(
        chart,
        "errors-auth-1p",
        ERRORS_ITEM_ID,
        { name: "errors-auth" },
      );
      const authSecret = Secret.fromSecretName(
        chart,
        "errors-auth-secret",
        authItem.name,
      );
      return {
        init: [buildErrorsMigrateContainer(database.env)],
        server: buildErrorsServerContainer(
          database.env,
          authSecret,
          errorsTailnet.origin,
        ),
      };
    },
    serviceName: ERRORS_ADMIN_ENDPOINT.service,
    tailscale: {
      probePath: "/readyz",
      hosts: [
        {
          id: "errors-ingress",
          host: errorsTailnet,
        },
      ],
    },
    policies: [
      {
        name: "errors-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([ERRORS_ADMIN_ENDPOINT.port]),
          blackboxProbeIngressRule(ERRORS_ADMIN_ENDPOINT.port),
          {
            from: [nsPeer("tailscale")],
            ports: [ERRORS_ADMIN_ENDPOINT.tcp()],
          },
          cloudflareTunnelIngressRule([ERRORS_INGEST_ENDPOINT.port]),
          blackboxProbeIngressRule(ERRORS_INGEST_ENDPOINT.port),
          {
            from: [{ namespaceSelector: {} }],
            ports: [ERRORS_INGEST_ENDPOINT.tcp()],
          },
        ],
        egress: [
          dnsEgressRule(),
          database.egress,
          flagsEgress(),
          {
            to: [MAIL_API_ENDPOINT.peer()],
            ports: [MAIL_API_ENDPOINT.tcp()],
          },
          {
            to: [TRACKER_ENDPOINT.peer()],
            ports: [TRACKER_ENDPOINT.tcp()],
          },
          {
            to: [nsPeer("bugsink")],
            ports: [tcp(8000)],
          },
          otlpEgress(),
        ],
      },
    ],
  });

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on errors Deployment");
  }
  serverContainer.addPort({
    name: ERRORS_INGEST_ENDPOINT.portName,
    number: ERRORS_INGEST_ENDPOINT.port,
  });

  const ingestService = new Service(chart, "errors-ingest-service", {
    metadata: { name: ERRORS_INGEST_ENDPOINT.service },
    selector: Pods.select(chart, "errors-ingest-selector", {
      labels: { app: ERRORS_INGEST_ENDPOINT.app },
    }),
    ports: [
      {
        port: ERRORS_INGEST_ENDPOINT.port,
        name: ERRORS_INGEST_ENDPOINT.portName,
      },
    ],
  });

  createCloudflareTunnelBinding(chart, "errors-cf-tunnel", {
    serviceName: ingestService.name,
    port: ERRORS_INGEST_ENDPOINT.port,
    probePath: "/healthz",
    publicProbePath: "/healthz",
  });

  return webService;
}
