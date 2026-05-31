import type { Chart } from "cdk8s";
import { ClusterTunnel } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-types/cfargotunnel.ts";
import { CLOUDFLARE_TUNNEL_SECRET_NAME } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";

export function createCloudflareTunnelCRD(chart: Chart) {
  // Create ClusterTunnel CRD (cluster-scoped, accessible from all namespaces)
  // This will automatically:
  // 1. Create a Cloudflare Tunnel named "homelab-k8s"
  // 2. Deploy cloudflared pods
  //
  // Note: For ClusterTunnel, the cloudflare-operator looks for the API token secret
  // in the cloudflare-operator-system namespace (where the operator runs).
  // The secret is created by cloudflare-operator.ts via 1Password.
  new ClusterTunnel(chart, "cloudflare-tunnel-crd", {
    metadata: {
      name: "homelab-tunnel",
    },
    spec: {
      cloudflare: {
        // newTunnel mode: operator owns the credential lifecycle, so the
        // CLOUDFLARE_TUNNEL_CREDENTIAL_* key-name overrides don't apply.
        secret: CLOUDFLARE_TUNNEL_SECRET_NAME,
        accountId: "48948ed6cd40d73e34d27f0cc10e595f",
        domain: "sjer.red",
      },
      newTunnel: {
        name: "homelab-k8s",
      },
    },
  });
}
