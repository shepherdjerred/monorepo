import type { Deployment } from "cdk8s-plus-31";
import { createTailscaleIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale-ingress-observer.ts";

/** Fixed operator-owned human ingress; this is identity policy, never selected release state. */
export const FLAGS_TAILSCALE_INGRESS = {
  namespace: "flags",
  name: "flags-flags-ingress-ingress",
  proxyNamespace: "tailscale",
  serviceName: "flags",
  port: 7360,
  host: "flags",
  directory: "/var/run/flags-ingress",
  parentLabels: {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource-type": "ingress",
    "tailscale.com/parent-resource-ns": "flags",
    "tailscale.com/parent-resource": "flags-flags-ingress-ingress",
  },
} as const;

/** Tailscale supplies operator headers; Flags independently verifies the actual proxy peer IP. */
export function createFlagsIngressObserver(deployment: Deployment) {
  return createTailscaleIngressObserver(deployment, {
    accountConstructId: "flags-ingress-observer-account",
    accountName: "flags-ingress-observer",
    roleName: "flags-ingress-observer",
    constructSuffix: "flags-ingress-observer",
    ingressNamespace: FLAGS_TAILSCALE_INGRESS.namespace,
    ingressName: FLAGS_TAILSCALE_INGRESS.name,
    proxyNamespace: FLAGS_TAILSCALE_INGRESS.proxyNamespace,
    mountPath: FLAGS_TAILSCALE_INGRESS.directory,
  });
}
