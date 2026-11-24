import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import {
  flagsEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { TRACKER_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  nsPeer,
  flagsEgress,
  otlpEgress,
  seaweedfsEgress,
  dnsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { requireFirstPartyImage } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/** A synthesis recipe is replaced by the required PG image binding before packaging. */
export function createTrackerDeployment(
  chart: Chart,
  image: string,
  database: SingleAppDatabase,
) {
  requireFirstPartyImage("tracker", image);
  const s3Item = seaweedfsS3.item(chart, "tracker-seaweedfs-1p");
  const s3 = Secret.fromSecretName(chart, "tracker-s3", s3Item.name);
  const dbEnv = database.env;
  const securityContext = restrictedContainer(1000);
  return new FirstPartyWebService(chart, "tracker-web-service", {
    name: "tracker",
    port: TRACKER_ENDPOINT.port,
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: "tracker" } },
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
          PORT: EnvValue.fromValue(String(TRACKER_ENDPOINT.port)),
          ENVIRONMENT: EnvValue.fromValue("production"),
          S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
          ...seaweedfsS3.bucketEnv("S3_BUCKET", "tracker"),
          S3_REGION: EnvValue.fromValue("us-east-1"),
          ...seaweedfsS3.credentialsEnv(s3),
          ...flagsEnv({ deployment: "tracker/prod" }),
          OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(
            OTLP_GATEWAY_BASE_URL,
          ),
        },
      },
    }),
    serviceName: "tracker",
    tailscale: {
      probePath: "/readyz",
      hosts: [{ id: "tracker-ingress", host: tailnetService("tracker") }],
    },
    policies: [
      {
        name: "tracker-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [TRACKER_ENDPOINT.tcp()],
          },
          {
            from: [
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "infra-worker" } },
              },
            ],
            ports: [TRACKER_ENDPOINT.tcp()],
          },
        ],
        egress: [
          dnsEgressRule(),
          database.egress,
          seaweedfsEgress(),
          flagsEgress(),
          otlpEgress(),
        ],
      },
    ],
  });
}
