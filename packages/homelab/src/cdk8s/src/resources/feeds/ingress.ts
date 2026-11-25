import type { Deployment } from "cdk8s-plus-31";
import { createTailscaleIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale-ingress-observer.ts";

/** Fixed operator-owned human ingress; this is identity policy, never selected release state. */
export const FEEDS_TAILSCALE_INGRESS = {
  namespace: "feeds",
  name: "feeds-feeds-ingress-ingress",
  proxyNamespace: "tailscale",
  serviceName: "feeds",
  port: 7430,
  host: "feeds",
  directory: "/var/run/feeds-ingress",
  parentLabels: {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource-type": "ingress",
    "tailscale.com/parent-resource-ns": "feeds",
    "tailscale.com/parent-resource": "feeds-feeds-ingress-ingress",
  },
} as const;

/** Tailscale supplies operator headers; Feeds independently verifies the actual proxy peer IP. */
export function createFeedsIngressObserver(deployment: Deployment) {
  return createTailscaleIngressObserver(deployment, {
    accountConstructId: "feeds-ingress-observer-account",
    accountName: "feeds-ingress-observer",
    roleName: "feeds-ingress-observer",
    constructSuffix: "feeds-ingress-observer",
    ingressNamespace: FEEDS_TAILSCALE_INGRESS.namespace,
    ingressName: FEEDS_TAILSCALE_INGRESS.name,
    proxyNamespace: FEEDS_TAILSCALE_INGRESS.proxyNamespace,
    mountPath: FEEDS_TAILSCALE_INGRESS.directory,
  });
}
