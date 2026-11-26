import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ARTIFACTS_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import {
  flagsEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  flagsEgress,
  nsPeer,
  prometheusIngressRule,
  seaweedfsEgress,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const ARTIFACTS_ACTIVE = true;

const ARTIFACTS_UID = 1000;

/**
 * The two tailnet hosts, each a Tailscale Ingress onto the one Service. The
 * operator runs a proxy pod per Ingress and labels it with the Ingress it
 * serves, which is the only identity the NetworkPolicy can name: the server
 * trusts the `Tailscale-User-Login` header only because nothing else can reach
 * its port. `id` is the construct id `FirstPartyWebService` renders the
 * Ingress from, so the Ingress is named `artifacts-<id>-ingress`.
 */
function tailscaleIngress(id: string) {
  const name = `artifacts-${id}-ingress`;
  return {
    id,
    name,
    parentLabels: {
      "tailscale.com/managed": "true",
      "tailscale.com/parent-resource-type": "ingress",
      "tailscale.com/parent-resource-ns": "artifacts",
      "tailscale.com/parent-resource": name,
    },
  };
}

export const ARTIFACTS_APP_INGRESS = tailscaleIngress("artifacts-ingress");
export const ARTIFACTS_CONTENT_INGRESS = tailscaleIngress(
  "artifacts-content-ingress",
);

/** The Temporal worker the hourly cleanup activity runs on. */
const CLEANUP_WORKER_COMPONENT = "infra-worker";

export function createArtifactsDeployment(
  chart: Chart,
  database: SingleAppDatabase,
) {
  const appHost = tailnetService("artifacts");
  const contentHost = tailnetService("artifacts-content");
  const securityContext = restrictedContainer(ARTIFACTS_UID);
  const dbEnv = database.env;
  return new FirstPartyWebService(chart, "artifacts-web-service", {
    name: ARTIFACTS_ENDPOINT.app,
    port: ARTIFACTS_ENDPOINT.port,
    // The kubelet and blackbox reach the pod by IP or Service DNS, which is
    // neither tailnet host, so the server answers these as its internal class.
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: ARTIFACTS_ENDPOINT.app } },
      // A new pod runs its migration before the old one stops serving the old
      // schema; one replica, no volume.
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
    },
    containers: () => {
      const s3Item = seaweedfsS3.item(chart, "artifacts-seaweedfs-1p");
      const s3 = Secret.fromSecretName(chart, "artifacts-s3", s3Item.name);
      return {
        init: [
          {
            name: "prisma-migrate",
            image: firstPartyImageRecipe("artifacts"),
            command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
            securityContext,
            resources: {
              cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
              memory: {
                request: Size.mebibytes(64),
                limit: Size.mebibytes(256),
              },
            },
            envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
          },
        ],
        server: {
          image: firstPartyImageRecipe("artifacts"),
          securityContext,
          // Uploads stream through a sha256 check into 8 MiB multipart parts
          // (two in flight) and range reads stream out of the object store, so
          // memory does not grow with a file's size; the limit leaves room for
          // a handful of concurrent uploads. Hashing a 500 MiB upload is CPU
          // bound, hence the higher CPU limit.
          resources: {
            cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
            memory: {
              request: Size.mebibytes(128),
              limit: Size.mebibytes(768),
            },
          },
          envVariables: {
            ...dbEnv,
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(ARTIFACTS_ENDPOINT.port)),
            ENVIRONMENT: EnvValue.fromValue("production"),
            ARTIFACTS_APP_ORIGIN: EnvValue.fromValue(appHost.origin),
            ARTIFACTS_CONTENT_ORIGIN: EnvValue.fromValue(contentHost.origin),
            // The same operator login Flags, Feeds and Delivery admit. Agents
            // and the operator present it alike, so no bearer token exists.
            ARTIFACTS_OPERATOR_LOGINS: EnvValue.fromValue(
              "shepherdjerred@gmail.com",
            ),
            S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
            ...seaweedfsS3.bucketEnv("S3_BUCKET", "artifacts"),
            S3_REGION: EnvValue.fromValue(seaweedfsS3.region),
            ...seaweedfsS3.credentialsEnv(s3),
            ...flagsEnv({ deployment: "artifacts/prod" }),
          },
        },
      };
    },
    serviceName: ARTIFACTS_ENDPOINT.service,
    tailscale: {
      probePath: "/readyz",
      hosts: [
        { id: ARTIFACTS_APP_INGRESS.id, host: appHost },
        { id: ARTIFACTS_CONTENT_INGRESS.id, host: contentHost },
      ],
    },
    policies: [
      {
        name: "artifacts-app-netpol",
        selects: "app",
        ingress: [
          // Prometheus scrapes `/metrics` and blackbox-exporter probes
          // `/readyz`; both run in the `prometheus` namespace.
          prometheusIngressRule([ARTIFACTS_ENDPOINT.port]),
          {
            // Only the two ingress proxies and the cleanup worker: a pod that
            // could reach the port could forge the login header.
            from: [
              ...[ARTIFACTS_APP_INGRESS, ARTIFACTS_CONTENT_INGRESS].map(
                ({ parentLabels }) => ({
                  ...nsPeer("tailscale"),
                  podSelector: { matchLabels: parentLabels },
                }),
              ),
              {
                ...nsPeer("temporal"),
                podSelector: {
                  matchLabels: { component: CLEANUP_WORKER_COMPONENT },
                },
              },
            ],
            ports: [ARTIFACTS_ENDPOINT.tcp()],
          },
        ],
        egress: [
          dnsEgressRule(),
          database.egress,
          seaweedfsEgress(),
          flagsEgress(),
        ],
      },
    ],
  });
}
