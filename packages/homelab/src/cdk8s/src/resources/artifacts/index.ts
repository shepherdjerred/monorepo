import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { bunServerEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
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
export const ARTIFACTS_ACTIVE = false;

const ARTIFACTS_PORT = 7440;

export function createArtifactsDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "artifacts-web-service", {
    name: "artifacts",
    port: ARTIFACTS_PORT,
    probes: { live: "/healthz", ready: "/healthz" },
    containers: () => ({
      server: {
        image: firstPartyImageRecipe("artifacts"),
        securityContext: restrictedContainer(1000),
        resources: {
          cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
          memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
        },
        envVariables: {
          ...bunServerEnv(ARTIFACTS_PORT),
          ENVIRONMENT: EnvValue.fromValue("production"),
        },
      },
    }),
    serviceName: "artifacts",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "artifacts-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "artifacts" in
          // platform-model.json and replaces this with tailnetService("artifacts").
          host: {
            host: "artifacts",
            namespace: "artifacts",
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "artifacts-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [tcp(ARTIFACTS_PORT)],
          },
        ],
        // Add an egress rule for each dependency the service calls.
        egress: [dnsEgressRule()],
      },
    ],
  });
}
