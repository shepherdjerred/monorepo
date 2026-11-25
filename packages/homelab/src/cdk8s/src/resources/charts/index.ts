import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  Secret,
  Volume,
  type ISecret,
} from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  nsPeer,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const CHARTS_ACTIVE = false;

const CHARTS_PORT = 7370;
const CHARTS_UID = 1000;
const CHARTS_DATA_PATH = "/var/lib/charts";
const CHARTS_AUTH_MOUNT_PATH = "/run/secrets/charts-auth";

const CHARTS_RESOURCES = {
  cpu: { request: Cpu.millis(25), limit: Cpu.millis(500) },
  memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
};

function buildChartsEnv(authSecret: ISecret): Record<string, EnvValue> {
  return {
    HOME: EnvValue.fromValue("/tmp"),
    HOST: EnvValue.fromValue("0.0.0.0"),
    PORT: EnvValue.fromValue(String(CHARTS_PORT)),
    CHARTS_DATA_DIR: EnvValue.fromValue(CHARTS_DATA_PATH),
    CHARTS_BASIC_AUTH_USER: EnvValue.fromSecretValue({
      secret: authSecret,
      key: "username",
    }),
    CHARTS_BASIC_AUTH_PASS_FILE: EnvValue.fromValue(
      `${CHARTS_AUTH_MOUNT_PATH}/password`,
    ),
  };
}

const CONSUMER_NAMESPACES = [
  "tailscale",
  "argocd",
  "delivery",
  "delivery-platform-jobs",
  "delivery-worker-jobs",
  "woodpecker-ci",
  "temporal",
] as const;

export function createChartsDeployment(chart: Chart) {
  let authVolume: Volume | undefined;
  const webService = new FirstPartyWebService(chart, "charts-web-service", {
    name: "charts",
    port: CHARTS_PORT,
    probes: { live: "/healthz", ready: "/readyz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: {
        fsGroup: CHARTS_UID,
        fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
      },
    },
    data: {
      id: "charts-data",
      storage: Size.gibibytes(8),
      path: CHARTS_DATA_PATH,
    },
    containers: () => {
      const authItem = onePasswordSecret(
        chart,
        "charts-basic-auth-1p",
        "wwoism5fsvmbisv4ef47yxqy2i",
        { name: "charts-basic-auth" },
      );
      const authSecret = Secret.fromSecretName(
        chart,
        "charts-basic-auth-secret",
        authItem.name,
      );
      authVolume = Volume.fromSecret(
        chart,
        "charts-basic-auth-volume",
        authSecret,
        {
          name: "charts-basic-auth",
          items: { password: { path: "password" } },
          defaultMode: 0o400,
        },
      );
      return {
        server: {
          image: firstPartyImageRecipe("charts"),
          securityContext: restrictedContainer(CHARTS_UID),
          resources: CHARTS_RESOURCES,
          envVariables: buildChartsEnv(authSecret),
        },
      };
    },
    serviceName: "charts",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "charts-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "charts" in
          // platform-model.json and replaces this with tailnetService("charts").
          host: {
            host: "charts",
            namespace: "charts",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "charts-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([CHARTS_PORT]),
          {
            from: CONSUMER_NAMESPACES.map((namespace) => nsPeer(namespace)),
            ports: [tcp(CHARTS_PORT)],
          },
        ],
        egress: [dnsEgressRule()],
      },
    ],
  });

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined || authVolume === undefined) {
    throw new Error("Expected server container and auth volume on charts");
  }
  serverContainer.mount(CHARTS_AUTH_MOUNT_PATH, authVolume, {
    readOnly: true,
  });

  return webService;
}
