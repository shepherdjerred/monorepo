import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
} from "cdk8s-plus-31";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FEEDS_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  FirstPartyWebService,
  type FirstPartyInitContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  blackboxProbeIngressRule,
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  flagsEgress,
  kubernetesApiEgressRule,
  nsPeer,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import {
  createFeedsIngressObserver,
  FEEDS_TAILSCALE_INGRESS,
} from "./ingress.ts";

export const FEEDS_ACTIVE = true;

const FEEDS_HTTP_PORT = FEEDS_ENDPOINT.port;
const FEEDS_READER_PORT = 7431;
const FEEDS_ITEM_ID = "hs2u3hto2k2e77sdjceh6pkuru";
const FEEDS_READER_SERVICE_NAME = "feeds-reader-service";
const FEEDS_DATA_PATH = "/var/lib/feeds";
const FEEDS_SQLITE_PATH = `${FEEDS_DATA_PATH}/feeds.sqlite`;

/** Public HTTP/HTTPS feed polling excluding RFC1918, CGNAT/Tailscale, and link-local ranges. */
const PUBLIC_FEED_EGRESS_BLOCK_EXCEPTIONS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
];

/** Applies Feeds' Prisma migrations before the server starts. */
function buildFeedsMigrateContainer(
  dbEnv: Record<string, EnvValue>,
): FirstPartyInitContainer {
  return {
    name: "prisma-migrate",
    image: firstPartyImageRecipe("feeds"),
    command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
    securityContext: restrictedContainer(1000),
    resources: {
      cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
      memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
    },
    envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
  };
}

/**
 * Copies the SQLite file into PostgreSQL and verifies the copy before the
 * server starts. The Recreate strategy stops the old pod first, so the file
 * is quiescent. Any failed gate fails the pod and leaves the file untouched.
 * Once PostgreSQL holds the cutover marker, the importer exits without
 * writing.
 */
function buildFeedsSqliteImportContainer(
  dbEnv: Record<string, EnvValue>,
): FirstPartyInitContainer {
  return {
    name: "sqlite-import",
    image: firstPartyImageRecipe("feeds"),
    command: [
      "bun",
      "src/migration/import-sqlite.ts",
      "--from",
      FEEDS_SQLITE_PATH,
      "--cutover",
    ],
    securityContext: restrictedContainer(1000),
    resources: {
      cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
      memory: { request: Size.mebibytes(128), limit: Size.mebibytes(768) },
    },
    envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
  };
}

export function createFeedsDeployment(
  chart: Chart,
  database: SingleAppDatabase,
) {
  const feedsTailnet = tailnetService("feeds");
  const webService = new FirstPartyWebService(chart, "feeds-web-service", {
    name: "feeds",
    port: FEEDS_HTTP_PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: { fsGroup: 1000 },
    },
    containers: () => {
      const authItem = onePasswordSecret(
        chart,
        "feeds-auth-1p",
        FEEDS_ITEM_ID,
        { name: "feeds-auth" },
      );
      const authSecret = Secret.fromSecretName(
        chart,
        "feeds-auth-secret",
        authItem.name,
      );
      return {
        init: [
          buildFeedsMigrateContainer(database.env),
          buildFeedsSqliteImportContainer(database.env),
        ],
        server: {
          image: firstPartyImageRecipe("feeds"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(25), limit: Cpu.millis(500) },
            memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
          },
          envVariables: {
            ...database.env,
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(FEEDS_HTTP_PORT)),
            FEEDS_READER_PORT: EnvValue.fromValue(String(FEEDS_READER_PORT)),
            ENVIRONMENT: EnvValue.fromValue("production"),
            FEEDS_PUBLIC_ORIGIN: EnvValue.fromValue(feedsTailnet.origin),
            FEEDS_OPERATOR_LOGINS: EnvValue.fromValue(
              "shepherdjerred@gmail.com",
            ),
            FEEDS_INGRESS_IDENTITY_DIR: EnvValue.fromValue(
              FEEDS_TAILSCALE_INGRESS.directory,
            ),
            FEEDS_READER_USER: EnvValue.fromValue("sjerred"),
            FEEDS_MACHINE_TOKEN: EnvValue.fromSecretValue({
              secret: authSecret,
              key: "FEEDS_MACHINE_TOKEN",
            }),
            FEEDS_READER_PASSWORD: EnvValue.fromSecretValue({
              secret: authSecret,
              key: "FEEDS_READER_PASSWORD",
            }),
            FEEDS_WRITE_TOKEN_SECRET: EnvValue.fromSecretValue({
              secret: authSecret,
              key: "FEEDS_WRITE_TOKEN_SECRET",
            }),
            ...flagsEnv({ deployment: "feeds/prod" }),
          },
        },
      };
    },
    // The SQLite file the cutover import reads; removed once the move is
    // verified and backed up.
    data: {
      id: "feeds-data",
      storage: Size.gibibytes(2),
      path: FEEDS_DATA_PATH,
    },
    serviceName: "feeds",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "feeds-ingress",
          host: feedsTailnet,
        },
      ],
    },
    policies: [
      {
        name: "feeds-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([FEEDS_HTTP_PORT]),
          blackboxProbeIngressRule(FEEDS_HTTP_PORT),
          {
            from: [
              {
                ...nsPeer(FEEDS_TAILSCALE_INGRESS.proxyNamespace),
                podSelector: {
                  matchLabels: FEEDS_TAILSCALE_INGRESS.parentLabels,
                },
              },
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "repo-worker" } },
              },
            ],
            ports: [tcp(FEEDS_HTTP_PORT)],
          },
          cloudflareTunnelIngressRule([FEEDS_READER_PORT]),
          blackboxProbeIngressRule(FEEDS_READER_PORT),
        ],
        egress: [
          dnsEgressRule(),
          kubernetesApiEgressRule(),
          flagsEgress(),
          database.egress,
          {
            to: [
              {
                ipBlock: {
                  cidr: "0.0.0.0/0",
                  except: PUBLIC_FEED_EGRESS_BLOCK_EXCEPTIONS,
                },
              },
            ],
            ports: [tcp(80), tcp(443)],
          },
        ],
      },
    ],
  });

  createFeedsIngressObserver(webService.deployment);

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on feeds Deployment");
  }
  serverContainer.addPort({
    name: "reader",
    number: FEEDS_READER_PORT,
  });

  const readerService = new Service(chart, "feeds-reader-service", {
    metadata: { name: FEEDS_READER_SERVICE_NAME },
    selector: webService.deployment,
    ports: [{ name: "reader", port: FEEDS_READER_PORT }],
  });

  createCloudflareTunnelBinding(chart, "feeds-cf-tunnel", {
    serviceName: readerService.name,
    port: FEEDS_READER_PORT,
    probePath: "/healthz",
    publicProbePath: "/healthz",
  });

  return webService;
}
