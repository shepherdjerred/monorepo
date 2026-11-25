import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  flagsEgress,
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const MAIL_ACTIVE = false;

export function createMailDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "mail-web-service", {
    name: "mail",
    port: 7370,
    probes: { live: "/healthz", ready: "/readyz" },
    containers: () => ({
      server: {
        image: firstPartyImageRecipe("mail"),
        securityContext: restrictedContainer(1000),
        resources: {
          cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
          memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
        },
        envVariables: {
          HOME: EnvValue.fromValue("/tmp"),
          HOST: EnvValue.fromValue("0.0.0.0"),
          PORT: EnvValue.fromValue("7370"),
          ENVIRONMENT: EnvValue.fromValue("production"),
          ...flagsEnv({ deployment: "mail/prod" }),
        },
      },
    }),
    serviceName: "mail",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "mail-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "mail" in
          // platform-model.json and replaces this with tailnetService("mail").
          host: {
            host: "mail",
            namespace: "mail",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "mail-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [tcp(7370)],
          },
        ],
        egress: [dnsEgressRule(), flagsEgress()],
      },
    ],
  });
}
