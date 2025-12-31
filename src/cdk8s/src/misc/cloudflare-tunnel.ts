import { Chart } from "cdk8s";
import { TunnelBinding, TunnelBindingTunnelRefKind } from "../../generated/imports/networking.cfargotunnel.com.ts";

export function createCloudflareTunnelBinding(
  chart: Chart,
  id: string,
  props: {
    serviceName: string;
    namespace?: string;
  } & ({ subdomain: string } | { fqdn: string }),
) {
  const fqdn = "fqdn" in props ? props.fqdn : `${props.subdomain}.sjer.red`;

  return new TunnelBinding(chart, id, {
    metadata: props.namespace ? { namespace: props.namespace } : undefined,
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
    },
  });
}
