import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { retainedResourceAnnotations } from "@shepherdjerred/homelab/cdk8s/src/misc/argocd-sync-options.ts";

export const DELIVERY_NAMESPACE = "delivery";

/**
 * The `delivery` Namespace. Under transition rendering the `delivery-data`
 * chart is its only owner and marks it retained, so neither a prune nor a
 * cascading delete of any Application can remove it (and with it the
 * PostgreSQL cluster). Otherwise the `delivery` chart renders it as before.
 */
export function createDeliveryNamespace(
  chart: Chart,
  { retained }: { retained: boolean },
): Namespace {
  return new Namespace(chart, "namespace", {
    metadata: {
      name: DELIVERY_NAMESPACE,
      ...(retained ? { annotations: retainedResourceAnnotations() } : {}),
    },
  });
}
