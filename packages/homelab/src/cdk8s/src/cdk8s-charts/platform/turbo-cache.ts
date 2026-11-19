import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createTurboCacheDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/turbo-cache.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  blackboxProbeIngressRule,
  dnsEgressRule,
  nsPeer,
  tailscaleIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

const TURBO_CACHE_PORT = 3000;

export function createTurboCacheChart(app: App) {
  const chart = new Chart(app, "turbo-cache", {
    namespace: "turbo-cache",
    disableResourceNameHashes: true,
  });

  createTurboCacheDeployment(chart);

  // The cache stores artifacts on its own claim and calls nothing. Clients
  // reach it over the tailnet; the CI maintenance worker calls `/v8/clean` on
  // the Service (`TURBO_CACHE_CLEAN_URL` in packages/temporal).
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "turbo-cache-netpol",
        selects: "namespace",
        ingress: [
          tailscaleIngressRule([TURBO_CACHE_PORT]),
          blackboxProbeIngressRule(TURBO_CACHE_PORT),
          {
            from: [
              {
                ...nsPeer(WOODPECKER_CI_NAMESPACE),
                podSelector: {
                  matchLabels: { component: "maintenance-worker" },
                },
              },
            ],
            ports: [tcp(TURBO_CACHE_PORT)],
          },
        ],
        egress: [dnsEgressRule()],
      },
    ],
    undefined,
  );
}
