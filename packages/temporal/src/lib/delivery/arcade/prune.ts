import type { DeliverySelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  retiredRouteSyncPrunes,
  selectionRelease,
  type RetiredRouteRule,
} from "#lib/delivery/retired-route-prune.ts";

const ARCADE: RetiredRouteRule = {
  application: "arcade",
  chart: "arcade",
  namespace: "arcade",
  environmentId: "arcade/prod",
  routes: new Set([
    "/Service/arcade-legacy-redirects",
    "networking.k8s.io/Ingress/arcade-mariokart-tailscale-ingress",
    "networking.k8s.io/Ingress/arcade-pokebot-tailscale-ingress",
    "networking.cfargotunnel.com/TunnelBinding/arcade-mariokart-cf-tunnel",
    "networking.cfargotunnel.com/TunnelBinding/arcade-pokebot-cf-tunnel",
  ]),
  label: "Arcade",
};

/** Retire only Arcade's five legacy hostname objects through its owned release. */
export async function arcadeSyncPrunes(
  selection: DeliverySelection,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  return await retiredRouteSyncPrunes(
    ARCADE,
    selectionRelease(selection),
    read,
  );
}
