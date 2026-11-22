import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createS3StaticSitesDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/s3-static-sites/index.ts";
import {
  STATIC_SITE_HTTP_PORT,
  STATIC_SITE_METRICS_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  nsPeer,
  prometheusIngressRule,
  seaweedfsEgress,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createS3StaticSitesChart(app: App) {
  const chart = new Chart(app, "s3-static-sites", {
    namespace: "s3-static-sites",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "s3-static-sites-namespace", {
    metadata: {
      name: "s3-static-sites",
    },
  });

  createS3StaticSitesDeployment(chart);

  // Caddy is reached only through the public tunnel; its blackbox probes go
  // to the public hostnames. It reads the buckets from SeaweedFS S3 and
  // reverse-proxies Scout's API paths to each stage's backend
  // (`resources/s3-static-sites/sites.ts`).
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "s3-static-sites-netpol",
        selects: "namespace",
        ingress: [
          cloudflareTunnelIngressRule([STATIC_SITE_HTTP_PORT]),
          prometheusIngressRule([STATIC_SITE_METRICS_PORT]),
        ],
        egress: [
          dnsEgressRule(),
          seaweedfsEgress(),
          {
            to: ["scout-prod", "scout-beta"].map((namespace) => ({
              ...nsPeer(namespace),
              podSelector: { matchLabels: { app: "scout-backend" } },
            })),
            ports: [tcp(3000)],
          },
        ],
      },
    ],
    undefined,
  );
}
