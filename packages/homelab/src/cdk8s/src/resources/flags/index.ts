import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
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
export const FLAGS_ACTIVE = false;

export function createFlagsDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "flags-web-service", {
    name: "flags",
    port: 7360,
    probes: { live: "/healthz", ready: "/healthz" },
    containers: () => ({
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
          PORT: EnvValue.fromValue("7360"),
          ENVIRONMENT: EnvValue.fromValue("production"),
          FLAGS_DATABASE_PATH: EnvValue.fromValue(
            "/var/lib/flags/flags.sqlite",
          ),
          FLAGS_PUBLIC_ORIGIN: EnvValue.fromValue(
            "https://flags.tailnet-1a49.ts.net",
          ),
        },
      },
    }),
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
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "flags" in
          // platform-model.json and replaces this with tailnetService("flags").
          host: {
            host: "flags",
            namespace: "flags",
            exposure: "ingress",
          },
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
            ports: [tcp(7360)],
          },
        ],
        // Add an egress rule for each dependency the service calls.
        egress: [dnsEgressRule()],
      },
    ],
  });
}
