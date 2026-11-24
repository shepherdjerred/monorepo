import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  flagsEgress,
  nsPeer,
  prometheusIngressRule,
  tailscaleIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const STORM_STATS_ACTIVE = false;

const STORM_STATS_PUBLIC_PORT = 7420;
const STORM_STATS_ADMIN_PORT = 7421;
const STORM_STATS_INGEST_PORT = 7422;

export function createStormStatsDeployment(chart: Chart) {
  const webService = new FirstPartyWebService(
    chart,
    "storm-stats-web-service",
    {
      name: "storm-stats",
      port: STORM_STATS_PUBLIC_PORT,
      probes: { live: "/healthz", ready: "/readyz" },
      deployment: {
        strategy: DeploymentStrategy.recreate(),
        automountServiceAccountToken: false,
        securityContext: { fsGroup: 1000 },
      },
      data: {
        id: "storm-stats-data",
        storage: Size.gibibytes(4),
        path: "/var/lib/storm-stats",
      },
      containers: () => ({
        server: {
          image: firstPartyImageRecipe("storm-stats"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
            memory: {
              request: Size.mebibytes(128),
              limit: Size.mebibytes(512),
            },
          },
          envVariables: {
            // Bun writes runtime state under $HOME; the root filesystem is
            // read-only, so HOME points at the writable emptyDir.
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(STORM_STATS_PUBLIC_PORT)),
            STORM_STATS_ADMIN_PORT: EnvValue.fromValue(
              String(STORM_STATS_ADMIN_PORT),
            ),
            STORM_STATS_DATABASE_PATH: EnvValue.fromValue(
              "/var/lib/storm-stats/storm-stats.sqlite",
            ),
            ENVIRONMENT: EnvValue.fromValue("production"),
            ...flagsEnv({ deployment: "storm/prod" }),
          },
        },
      }),
      serviceName: "storm-stats",
      tailscale: {
        probePath: "/healthz",
        hosts: [
          {
            id: "storm-stats-ingress",
            // Prepared service placeholder while STORM_STATS_ACTIVE is false and
            // platform-model.json does not yet declare storm-stats.
            // PR 2 activation declares public hostname `stats.ts-mc.net` and
            // tailnet service `storm-stats` in platform-model.json, binds
            // Cloudflare Tunnel `stats.ts-mc.net` on port 7420 and
            // TailscaleIngress `storm-stats` on admin port 7421, and mounts the
            // 1Password `STORM_STATS_INGEST_TOKEN` secret alongside
            // `STORM_STATS_INGEST_PORT=7422`.
            host: {
              host: "storm-stats",
              namespace: "storm-stats",
              exposure: "ingress",
            },
          },
        ],
      },
      policies: [
        {
          name: "storm-stats-app-netpol",
          selects: "app",
          ingress: [
            cloudflareTunnelIngressRule([STORM_STATS_PUBLIC_PORT]),
            tailscaleIngressRule([STORM_STATS_ADMIN_PORT]),
            prometheusIngressRule([
              STORM_STATS_PUBLIC_PORT,
              STORM_STATS_ADMIN_PORT,
            ]),
            {
              from: [nsPeer("minecraft-tsmc")],
              ports: [tcp(STORM_STATS_INGEST_PORT)],
            },
          ],
          egress: [dnsEgressRule(), flagsEgress()],
        },
      ],
    },
  );

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on storm-stats Deployment");
  }
  serverContainer.addPort({ name: "admin", number: STORM_STATS_ADMIN_PORT });
  serverContainer.addPort({ name: "ingest", number: STORM_STATS_INGEST_PORT });
  webService.service.bind(STORM_STATS_ADMIN_PORT, { name: "admin" });
  webService.service.bind(STORM_STATS_INGEST_PORT, { name: "ingest" });

  return webService;
}
