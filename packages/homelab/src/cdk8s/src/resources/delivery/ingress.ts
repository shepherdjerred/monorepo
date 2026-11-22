import type { Deployment } from "cdk8s-plus-31";
import { createTailscaleIngressObserver } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale-ingress-observer.ts";
import { DELIVERY_TAILSCALE_INGRESS as ingress } from "@shepherdjerred/ops-model/delivery-ingress.ts";
import { DELIVERY_API_SERVICE_ACCOUNT } from "@shepherdjerred/ops-model/delivery-readers.ts";

/** Existing operator supplies identity; the API independently verifies the actual proxy peer. */
export function createDeliveryIngressObserver(deployment: Deployment) {
  // Preserve the narrowly guarded optional Forum CONNECT actor. Without the
  // Forum capability this account only receives the read-only roles below.
  return createTailscaleIngressObserver(deployment, {
    accountConstructId: "api-observer",
    accountName: DELIVERY_API_SERVICE_ACCOUNT.name,
    roleName: "delivery-ingress-observer",
    constructSuffix: "ingress-observer",
    ingressNamespace: ingress.namespace,
    ingressName: ingress.name,
    proxyNamespace: ingress.proxyNamespace,
    mountPath: "/var/run/delivery-ingress",
  });
}
