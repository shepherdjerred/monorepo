import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FLIPT_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  fliptEgress,
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";

export const FLAGS_ACTIVE = true;

const FLAGS_HTTP_PORT = 7360;
const FLAGS_EVALUATION_PORT = 7361;
const FLAGS_ITEM_ID = "dzcroze2qcoibfz3illceozbea";

export function createFlagsDeployment(chart: Chart) {
  const flagsTailnet = tailnetService("flags");
  const webService = new FirstPartyWebService(chart, "flags-web-service", {
    name: "flags",
    port: FLAGS_HTTP_PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
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
            FLAGS_TRUSTED_PROXIES: EnvValue.fromValue("10.244.0.0/16"),
            FLAGS_FLIPT_URL: EnvValue.fromValue(FLIPT_URL),
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
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [tcp(FLAGS_HTTP_PORT)],
          },
        ],
        egress: [dnsEgressRule(), fliptEgress()],
      },
    ],
  });

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on flags Deployment");
  }
  serverContainer.addPort({ name: "eval", number: FLAGS_EVALUATION_PORT });
  webService.service.bind(FLAGS_EVALUATION_PORT, { name: "eval" });

  return webService;
}
