import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createS3StaticSitesDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/s3-static-sites/index.ts";
import {
  PRIVATE_SHARE_APP_LABELS,
  PRIVATE_SHARE_PORT,
  PUBLIC_STATIC_SITES_APP_LABELS,
  createPrivateShareSite,
} from "@shepherdjerred/homelab/cdk8s/src/resources/s3-static-sites/private.ts";
import {
  STATIC_SITE_HTTP_PORT,
  STATIC_SITE_METRICS_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  blackboxProbeIngressRule,
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  nsPeer,
  prometheusIngressRule,
  seaweedfsEgress,
  tailscaleIngressRule,
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
  createPrivateShareSite(chart);

  // The public Caddy is reached only through the public tunnel; its blackbox probes go
  // to the public hostnames. It reads the buckets from SeaweedFS S3 and
  // reverse-proxies Scout's API paths to each stage's backend
  // (`resources/s3-static-sites/sites.ts`).
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "s3-static-sites-netpol",
        selects: "app",
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
    PUBLIC_STATIC_SITES_APP_LABELS,
  );

  // The tailnet-only Caddy is reached only through the Tailscale proxy (and
  // blackbox-exporter's probe of that Ingress's Service) and reads only
  // SeaweedFS. Its own policy, so the public pod's tunnel ingress and Scout
  // egress do not apply to it, and the other way round.
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "s3-static-sites-private-netpol",
        selects: "app",
        ingress: [
          tailscaleIngressRule([PRIVATE_SHARE_PORT]),
          blackboxProbeIngressRule(PRIVATE_SHARE_PORT),
        ],
        egress: [dnsEgressRule(), seaweedfsEgress()],
      },
    ],
    PRIVATE_SHARE_APP_LABELS,
  );
}
