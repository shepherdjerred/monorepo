import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { BRIM_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { seaweedfsS3 } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  nsPeer,
  prometheusIngressRule,
  seaweedfsEgress,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const BRIM_SERVICE_ACTIVE = false;

const PORT = BRIM_ENDPOINT.port;
const DATA_PATH = "/data";
const ARCHIVE_PATH = "/archive";
const INGRESS_ID = "brim-service-ingress";

export function createBrimServiceDeployment(chart: Chart) {
  const service = new FirstPartyWebService(chart, "brim-service-web-service", {
    name: "brim-service",
    port: PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      securityContext: { fsGroup: 1000 },
      automountServiceAccountToken: false,
    },
    data: {
      id: "brim-service-data",
      storage: Size.gibibytes(8),
      path: DATA_PATH,
    },
    containers: () => {
      const item = onePasswordSecret(chart, "brim-service-1p", "brim-service");
      const secret = Secret.fromSecretName(
        chart,
        "brim-service-secret",
        item.name,
      );
      const credential = (key: string) =>
        EnvValue.fromSecretValue({ secret, key });
      return {
        server: {
          image: firstPartyImageRecipe("brim-service"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(250), limit: Cpu.millis(1500) },
            memory: { request: Size.mebibytes(512), limit: Size.gibibytes(2) },
          },
          envVariables: {
            HOME: EnvValue.fromValue("/tmp"),
            PORT: EnvValue.fromValue(String(PORT)),
            BRIM_DATA_DIR: EnvValue.fromValue(DATA_PATH),
            BRIM_ARCHIVE_DIR: EnvValue.fromValue(ARCHIVE_PATH),
            AWS_ENDPOINT_URL_S3: EnvValue.fromValue(seaweedfsS3.endpoint),
            AWS_REGION: EnvValue.fromValue(seaweedfsS3.region),
            AWS_ACCESS_KEY_ID: credential("BRIM_ARCHIVE_ACCESS_KEY_ID"),
            AWS_SECRET_ACCESS_KEY: credential("BRIM_ARCHIVE_SECRET_ACCESS_KEY"),
            BRIM_SYNC_AGE_IDENTITY: credential("BRIM_SYNC_AGE_IDENTITY"),
            BRIM_HUB_TOKEN: credential("BRIM_HUB_TOKEN"),
            BRIM_DEVICE_TOKEN: credential("BRIM_DEVICE_TOKEN"),
            BRIM_MACBOOK_PUBLISH_TOKEN: credential(
              "BRIM_MACBOOK_PUBLISH_TOKEN",
            ),
            BRIM_SCHEDULER_TOKEN: credential("BRIM_SCHEDULER_TOKEN"),
          },
        },
      };
    },
    serviceName: "brim-service",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: INGRESS_ID,
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "brim" in
          // platform-model.json and replaces this with tailnetService("brim").
          host: {
            host: "brim",
            namespace: "brim-service",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "brim-service-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([PORT]),
          {
            from: [
              {
                ...nsPeer("tailscale"),
                podSelector: {
                  matchLabels: {
                    "tailscale.com/managed": "true",
                    "tailscale.com/parent-resource-type": "ingress",
                    "tailscale.com/parent-resource-ns": "brim-service",
                    "tailscale.com/parent-resource": `brim-service-${INGRESS_ID}-ingress`,
                  },
                },
              },
              {
                ...nsPeer("alert-dashboard"),
                podSelector: { matchLabels: { app: "alert-dashboard" } },
              },
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "infra-worker" } },
              },
            ],
            ports: [tcp(PORT)],
          },
        ],
        egress: [dnsEgressRule(), seaweedfsEgress()],
      },
    ],
  });
  // Session records and their indexes can be reconstructed from the encrypted
  // SeaweedFS archive. Isolate their decrypted local copies from metadata backups.
  const archive = new ZfsNvmeVolume(chart, "brim-service-archive", {
    storage: Size.gibibytes(64),
  });
  const archiveVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "brim-service-archive-volume",
    archive.claim,
  );
  const [server] = service.deployment.containers;
  if (server === undefined)
    throw new Error("Brim service has no server container");
  server.mount(ARCHIVE_PATH, archiveVolume);
  return service;
}
