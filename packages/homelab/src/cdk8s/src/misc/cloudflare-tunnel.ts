import type { Chart } from "cdk8s";
import {
  TunnelBinding,
  TunnelBindingTunnelRefKind,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/networking.cfargotunnel.com.ts";

// Secret name that the cloudflare-operator expects
// Note: For ClusterTunnel, the secret must be in cloudflare-operator-system namespace
// This is created in cloudflare-operator.ts
export const CLOUDFLARE_TUNNEL_SECRET_NAME = "cloudflare-tunnel-config";

export function createCloudflareTunnelBinding(
  chart: Chart,
  id: string,
  props: {
    serviceName: string;
    namespace?: string;
    annotations?: Record<string, string>;
    disableDnsUpdates?: boolean;
  } & ({ subdomain: string } | { fqdn: string }),
) {
  const fqdn = "fqdn" in props ? props.fqdn : `${props.subdomain}.sjer.red`;

  return new TunnelBinding(chart, id, {
    metadata: {
      ...(props.namespace === undefined ? {} : { namespace: props.namespace }),
      ...(props.annotations === undefined ? {} : { annotations: props.annotations }),
      // Labels and finalizer added by cloudflare-operator controller - include to prevent ArgoCD drift
      labels: {
        "cfargotunnel.com/kind": "TunnelBinding",
        "cfargotunnel.com/name": "homelab-tunnel",
      },
      finalizers: ["cfargotunnel.com/finalizer"],
    },
    subjects: [
      {
        name: props.serviceName,
        spec: {
          fqdn,
        },
      },
    ],
    tunnelRef: {
      kind: TunnelBindingTunnelRefKind.CLUSTER_TUNNEL,
      name: "homelab-tunnel",
      disableDnsUpdates: props.disableDnsUpdates ?? true,
    },
  });
}
