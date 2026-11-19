import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  createGradleBuildCacheDeployment,
  GRADLE_BUILD_CACHE_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/gradle-build-cache.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  blackboxProbeIngressRule,
  dnsEgressRule,
  tailscaleIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const GRADLE_BUILD_CACHE_PORT = 8080;

export function createGradleBuildCacheChart(app: App) {
  const chart = new Chart(app, "gradle-build-cache", {
    namespace: GRADLE_BUILD_CACHE_NAMESPACE,
    disableResourceNameHashes: true,
  });

  createGradleBuildCacheDeployment(chart);

  // nginx serves its own claim and calls nothing; every client, CI included,
  // reaches it over the tailnet.
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "gradle-build-cache-netpol",
        selects: "namespace",
        ingress: [
          tailscaleIngressRule([GRADLE_BUILD_CACHE_PORT]),
          blackboxProbeIngressRule(GRADLE_BUILD_CACHE_PORT),
        ],
        egress: [dnsEgressRule()],
      },
    ],
    undefined,
  );
}
