import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  kubernetesApiEgressRule,
  nsPeer,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import {
  createFlagsIngressObserver,
  FLAGS_TAILSCALE_INGRESS,
} from "./ingress.ts";
import {
  FLAGS_EVALUATION_ENDPOINT,
  FLAGS_MANAGEMENT_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";

export const FLAGS_ACTIVE = true;

const FLAGS_HTTP_PORT = FLAGS_MANAGEMENT_ENDPOINT.port;
const FLAGS_EVALUATION_PORT = FLAGS_EVALUATION_ENDPOINT.port;
const FLAGS_ITEM_ID = "dzcroze2qcoibfz3illceozbea";

/**
 * Namespaces allowed to evaluate flags over the credentialless evaluation port.
 *
 * Operator UI and authenticated management routes stay on port 7360, restricted
 * to Tailscale, Prometheus health probes, and the Temporal repo worker.
 */
const CONSUMER_NAMESPACES = [
  "arcade",
  "delivery",
  "starlight-karma-bot-beta",
  "starlight-karma-bot-prod",
  "scout-beta",
  "scout-prod",
  "birmel",
  "temporal",
  "trmnl-dashboard",
  "alert-dashboard",
  // streambot is deployed inside the `media` chart, alongside media-api/workers.
  "media",
  "storm-brain",
  "storm-forum",
  "storm-forum-beta",
  "storm-stats",
  "minecraft-tsmc",
  // The Woodpecker maintenance worker runs the shared temporal-worker image in `woodpecker-ci`.
  "woodpecker-ci",
  "woodpecker",
  "tracker",
  "golink",
  "mail",
  "feeds",
  "errors",
] as const;

export function createFlagsDeployment(chart: Chart) {
  const flagsTailnet = tailnetService("flags");
  const webService = new FirstPartyWebService(chart, "flags-web-service", {
    name: "flags",
    port: FLAGS_HTTP_PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: { fsGroup: 1000 },
    },
    containers: () => {
      const authItem = onePasswordSecret(
        chart,
        "flags-auth-1p",
        FLAGS_ITEM_ID,
        { name: "flags-auth" },
      );
      const authSecret = Secret.fromSecretName(
        chart,
        "flags-auth-secret",
        authItem.name,
      );
      return {
        server: {
          image: firstPartyImageRecipe("flags"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
            memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
          },
          envVariables: {
            // Bun writes runtime state under $HOME; the root filesystem is
            // read-only, so HOME points at the writable emptyDir.
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(FLAGS_HTTP_PORT)),
            FLAGS_EVALUATION_PORT: EnvValue.fromValue(
              String(FLAGS_EVALUATION_PORT),
            ),
            ENVIRONMENT: EnvValue.fromValue("production"),
            FLAGS_DATABASE_PATH: EnvValue.fromValue(
              "/var/lib/flags/flags.sqlite",
            ),
            FLAGS_PUBLIC_ORIGIN: EnvValue.fromValue(flagsTailnet.origin),
            FLAGS_OPERATOR_LOGINS: EnvValue.fromValue(
              "shepherdjerred@gmail.com",
            ),
            FLAGS_INGRESS_IDENTITY_DIR: EnvValue.fromValue(
              FLAGS_TAILSCALE_INGRESS.directory,
            ),
            FLAGS_MACHINE_TOKEN: EnvValue.fromSecretValue({
              secret: authSecret,
              key: "FLAGS_MACHINE_TOKEN",
            }),
          },
        },
      };
    },
    data: {
      id: "flags-data",
      storage: Size.gibibytes(1),
      path: "/var/lib/flags",
    },
    serviceName: "flags",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "flags-ingress",
          host: flagsTailnet,
        },
      ],
    },
    policies: [
      {
        name: "flags-app-netpol",
        selects: "app",
        ingress: [
          prometheusIngressRule([FLAGS_HTTP_PORT]),
          {
            from: [
              {
                ...nsPeer(FLAGS_TAILSCALE_INGRESS.proxyNamespace),
                podSelector: {
                  matchLabels: FLAGS_TAILSCALE_INGRESS.parentLabels,
                },
              },
              {
                ...nsPeer("temporal"),
                podSelector: { matchLabels: { component: "repo-worker" } },
              },
            ],
            ports: [tcp(FLAGS_HTTP_PORT)],
          },
          {
            from: CONSUMER_NAMESPACES.map((namespace) => nsPeer(namespace)),
            ports: [tcp(FLAGS_EVALUATION_PORT)],
          },
        ],
        egress: [dnsEgressRule(), kubernetesApiEgressRule()],
      },
    ],
  });

  createFlagsIngressObserver(webService.deployment);

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on flags Deployment");
  }
  serverContainer.addPort({
    name: FLAGS_EVALUATION_ENDPOINT.portName,
    number: FLAGS_EVALUATION_PORT,
  });
  webService.service.bind(FLAGS_EVALUATION_PORT, {
    name: FLAGS_EVALUATION_ENDPOINT.portName,
  });

  return webService;
}
