import {
  retiredRouteSyncPrunes,
  type RetiredRouteRelease,
  type RetiredRouteRule,
} from "#lib/delivery/retired-route-prune.ts";

/**
 * Hub (the `alert-dashboard` Application) serves one hostname. Its owned
 * sync may prune only the retired `alerts` and `ops` Tailscale Ingresses;
 * the `hub` Ingress and the alert ledger's claim are never candidates.
 */
const HUB: RetiredRouteRule = {
  application: "alert-dashboard",
  chart: "alert-dashboard",
  namespace: "alert-dashboard",
  environmentId: "ops-dashboard/prod",
  routes: new Set([
    "networking.k8s.io/Ingress/alert-dashboard-alert-dashboard-ingress-ingress",
    "networking.k8s.io/Ingress/alert-dashboard-alert-dashboard-ops-ingress-ingress",
  ]),
  label: "Hub",
};

/** Retire only Hub's `alerts` and `ops` Ingresses through its owned release. */
export async function alertDashboardSyncPrunes(
  release: RetiredRouteRelease,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  return await retiredRouteSyncPrunes(HUB, release, read);
}
