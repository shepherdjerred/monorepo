import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  FirstPartyWebService,
  type FirstPartyServerContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
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
export const FEEDS_ACTIVE = false;

const FEEDS_CONSOLE_PORT = 7430;
const FEEDS_READER_PORT = 7431;
const FEEDS_UID = 1000;

function buildFeedsServerContainer(): FirstPartyServerContainer {
  const containerSecurity = restrictedContainer(FEEDS_UID);
  const envVariables: Record<string, EnvValue> = {
    ENVIRONMENT: EnvValue.fromValue("production"),
    FEEDS_READER_PORT: EnvValue.fromValue(String(FEEDS_READER_PORT)),
    HOME: EnvValue.fromValue("/tmp"),
    HOST: EnvValue.fromValue("0.0.0.0"),
    PORT: EnvValue.fromValue(String(FEEDS_CONSOLE_PORT)),
  };
  return {
    image: firstPartyImageRecipe("feeds"),
    securityContext: containerSecurity,
    resources: {
      cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
      memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
    },
    envVariables,
  };
}

export function createFeedsDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "feeds-web-service", {
    name: "feeds",
    port: FEEDS_CONSOLE_PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    containers: () => ({
      server: buildFeedsServerContainer(),
    }),
    serviceName: "feeds",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "feeds-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "feeds" in
          // platform-model.json and replaces this with tailnetService("feeds").
          host: {
            host: "feeds",
            namespace: "feeds",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "feeds-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [tcp(FEEDS_CONSOLE_PORT)],
          },
        ],
        egress: [dnsEgressRule()],
      },
    ],
  });
}
