import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  Pods,
  Secret,
  Service,
} from "cdk8s-plus-31";
import { publicHostname, tailnetService } from "homelab/src/platform-model.ts";
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
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const STORM_STATS_ACTIVE = true;

const STORM_STATS_PUBLIC_PORT = 7420;
const STORM_STATS_ADMIN_PORT = 7421;
/** The Storm game server posts its stats outbox here. */
export const STORM_STATS_INGEST_PORT = 7422;

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
      containers: () => {
        const secretsItem = onePasswordSecret(
          chart,
          "storm-stats-secrets-1p",
          "storm-stats",
          { name: "storm-stats-secrets" },
        );
        const stormStatsSecret = Secret.fromSecretName(
          chart,
          "storm-stats-secret-ref",
          secretsItem.name,
        );
        return {
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
              STORM_STATS_INGEST_PORT: EnvValue.fromValue(
                String(STORM_STATS_INGEST_PORT),
              ),
              STORM_STATS_INGEST_TOKEN: EnvValue.fromSecretValue({
                secret: stormStatsSecret,
                key: "STORM_STATS_INGEST_TOKEN",
              }),
              STORM_STATS_DATABASE_PATH: EnvValue.fromValue(
                "/var/lib/storm-stats/storm-stats.sqlite",
              ),
              ENVIRONMENT: EnvValue.fromValue("production"),
              ...flagsEnv({ deployment: "storm/prod" }),
            },
          },
        };
      },
      serviceName: "storm-stats",
      cloudflare: {
        id: "storm-stats-cf-tunnel",
        hostname: publicHostname("stats.ts-mc.net"),
        probePath: "/healthz",
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
  webService.service.bind(STORM_STATS_INGEST_PORT, { name: "ingest" });

  const adminService = new Service(chart, "storm-stats-admin-service", {
    metadata: { name: "storm-stats-admin" },
    selector: Pods.select(chart, "storm-stats-admin-selector", {
      labels: { app: "storm-stats" },
    }),
    ports: [{ port: STORM_STATS_ADMIN_PORT, name: "admin" }],
  });

  new TailscaleIngress(chart, "storm-stats-ingress", {
    service: adminService,
    port: STORM_STATS_ADMIN_PORT,
    host: tailnetService("storm-stats"),
    probePath: "/healthz",
  });

  return webService;
}
