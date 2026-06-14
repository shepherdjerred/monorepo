import type { Construct } from "constructs";
import {
  TunnelBinding,
  TunnelBindingTunnelRefKind,
} from "@shepherdjerred/homelab/cdk8s/src/cdk8s-types/cfargotunnel.ts";

// Secret name that the cloudflare-operator expects
// Note: For ClusterTunnel, the secret must be in cloudflare-operator-system namespace
// This is created in cloudflare-operator.ts
export const CLOUDFLARE_TUNNEL_SECRET_NAME = "cloudflare-tunnel-config";

export function createCloudflareTunnelBinding(
  scope: Construct,
  id: string,
  props: {
    serviceName: string;
    namespace?: string;
    annotations?: Record<string, string>;
    disableDnsUpdates?: boolean;
    /**
     * Origin protocol the cloudflared agent uses to reach the in-cluster
     * Service. Defaults to "http" (or "https" if the matched service port is
     * 443). Override to "https" for services that 307-redirect HTTP→HTTPS
     * (e.g. argocd-server in default secure mode); pair with `noTlsVerify`
     * since in-cluster TLS certs are typically self-signed.
     */
    protocol?: "http" | "https" | "tcp" | "udp" | "ssh" | "rdp";
    /** Skip TLS verification when `protocol: "https"`. */
    noTlsVerify?: boolean;
  } & ({ subdomain: string } | { fqdn: string }),
) {
  const fqdn = "fqdn" in props ? props.fqdn : `${props.subdomain}.sjer.red`;

  return new TunnelBinding(scope, id, {
    metadata: {
      ...(props.namespace === undefined ? {} : { namespace: props.namespace }),
      ...(props.annotations === undefined
        ? {}
        : { annotations: props.annotations }),
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
          ...(props.protocol === undefined ? {} : { protocol: props.protocol }),
          ...(props.noTlsVerify === undefined
            ? {}
            : { noTlsVerify: props.noTlsVerify }),
        },
      },
    ],
    tunnelRef: {
      kind: TunnelBindingTunnelRefKind.CLUSTER_TUNNEL,
      name: "homelab-tunnel",
      disableDNSUpdates: props.disableDnsUpdates ?? true,
    },
  });
}
