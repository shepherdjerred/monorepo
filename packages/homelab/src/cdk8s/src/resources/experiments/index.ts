import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { EXPERIMENTS_INTERNAL_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  kubernetesApiEgressRule,
  nsPeer,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createTailscaleIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale-ingress-observer.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const EXPERIMENTS_ACTIVE = false;
// Connect Hub and Ops Snapshot in the release after the service answers ready.
export const experimentsHubConfig: Readonly<{
  active: boolean;
  authItem: string;
}> = {
  active: false,
  authItem: "experiments-hub-auth",
};
export const EXPERIMENTS_OPERATOR_LOGIN = "shepherdjerred@gmail.com";

const PORT = 7407;
const INGRESS = {
  namespace: "experiments",
  name: "experiments-experiments-ingress-ingress",
  proxyNamespace: "tailscale",
  directory: "/var/run/experiments-ingress",
};

export function createExperimentsDeployment(
  chart: Chart,
  database: SingleAppDatabase,
) {
  const image = firstPartyImageRecipe("experiments");
  const web = new FirstPartyWebService(chart, "experiments-web-service", {
    name: "experiments",
    port: PORT,
    probes: { live: "/healthz", ready: "/readyz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: { fsGroup: 1000 },
    },
    containers: () => {
      const machine = onePasswordSecret(
        chart,
        "experiments-auth",
        "experiments-auth",
      );
      const hub = onePasswordSecret(
        chart,
        "experiments-hub-auth",
        experimentsHubConfig.authItem,
      );
      const machineSecret = Secret.fromSecretName(
        chart,
        "experiments-auth-secret",
        machine.name,
      );
      const hubSecret = Secret.fromSecretName(
        chart,
        "experiments-hub-secret",
        hub.name,
      );
      return {
        init: [
          {
            name: "prisma-migrate",
            image,
            command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
            securityContext: restrictedContainer(1000),
            resources: {
              cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
              memory: {
                request: Size.mebibytes(64),
                limit: Size.mebibytes(256),
              },
            },
            envVariables: { ...database.env, HOME: EnvValue.fromValue("/tmp") },
          },
        ],
        server: {
          image,
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
            memory: {
              request: Size.mebibytes(128),
              limit: Size.mebibytes(512),
            },
          },
          envVariables: {
            ...database.env,
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(PORT)),
            INTERNAL_PORT: EnvValue.fromValue(
              String(EXPERIMENTS_INTERNAL_ENDPOINT.port),
            ),
            ENVIRONMENT: EnvValue.fromValue("production"),
            EXPERIMENTS_PUBLIC_ORIGIN: EnvValue.fromValue(
              APP_HOSTS.experiments,
            ),
            EXPERIMENTS_OPERATOR_LOGINS: EnvValue.fromValue(
              EXPERIMENTS_OPERATOR_LOGIN,
            ),
            EXPERIMENTS_INGRESS_IDENTITY_DIR: EnvValue.fromValue(
              INGRESS.directory,
            ),
            EXPERIMENTS_MACHINE_TOKEN: EnvValue.fromSecretValue({
              secret: machineSecret,
              key: "EXPERIMENTS_MACHINE_TOKEN",
            }),
            EXPERIMENTS_HUB_TOKEN: EnvValue.fromSecretValue({
              secret: hubSecret,
              key: "EXPERIMENTS_HUB_TOKEN",
            }),
          },
        },
      };
    },
    serviceName: "experiments",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "experiments-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "experiments" in
          // platform-model.json and replaces this with tailnetService("experiments").
          host: {
            host: "experiments",
            namespace: "experiments",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "experiments-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [
              {
                ...nsPeer(INGRESS.proxyNamespace),
                podSelector: {
                  matchLabels: {
                    "tailscale.com/managed": "true",
                    "tailscale.com/parent-resource-type": "ingress",
                    "tailscale.com/parent-resource-ns": INGRESS.namespace,
                    "tailscale.com/parent-resource": INGRESS.name,
                  },
                },
              },
            ],
            ports: [tcp(PORT)],
          },
          prometheusIngressRule([PORT]),
          {
            from: [
              {
                ...nsPeer("alert-dashboard"),
                podSelector: { matchLabels: { app: "alert-dashboard" } },
              },
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "infra-worker" } },
              },
            ],
            ports: [EXPERIMENTS_INTERNAL_ENDPOINT.tcp()],
          },
        ],
        egress: [dnsEgressRule(), database.egress, kubernetesApiEgressRule()],
      },
    ],
  });
  createTailscaleIngressObserver(web.deployment, {
    accountConstructId: "experiments-ingress-observer-account",
    accountName: "experiments-ingress-observer",
    roleName: "experiments-ingress-observer",
    constructSuffix: "experiments-ingress-observer",
    ingressNamespace: INGRESS.namespace,
    ingressName: INGRESS.name,
    proxyNamespace: INGRESS.proxyNamespace,
    mountPath: INGRESS.directory,
  });
  const server = web.deployment.containers[0];
  if (server === undefined)
    throw new Error("Experiments server container is missing");
  server.addPort({
    name: EXPERIMENTS_INTERNAL_ENDPOINT.portName,
    number: EXPERIMENTS_INTERNAL_ENDPOINT.port,
  });
  web.service.bind(EXPERIMENTS_INTERNAL_ENDPOINT.port, {
    name: EXPERIMENTS_INTERNAL_ENDPOINT.portName,
  });
  return web;
}
