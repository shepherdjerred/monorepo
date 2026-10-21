import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { retainedResourceAnnotations } from "@shepherdjerred/homelab/cdk8s/src/misc/argocd-sync-options.ts";
import { TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/agent-worker.ts";

export const TEMPORAL_NAMESPACE = "temporal";

/**
 * The `temporal` Namespace. Under transition rendering the `temporal-data`
 * chart is its only owner and marks it retained, so neither a prune nor a
 * cascading delete of any Application can remove it (and with it the
 * PostgreSQL cluster). Otherwise the `temporal` chart renders it as before.
 */
export function createTemporalNamespace(
  chart: Chart,
  { retained }: { retained: boolean },
): Namespace {
  return new Namespace(chart, "temporal-namespace", {
    metadata: {
      name: TEMPORAL_NAMESPACE,
      labels: {
        // The report-only agent worker deliberately uses a short-lived
        // NET_ADMIN init container for its uid-owned egress firewall and
        // SETUID in the poller for the provider uid transition. PSA has no
        // pod-scoped exception, so enforcement must permit those explicit
        // capabilities at the namespace boundary while audit/warn retain the
        // baseline signal for every workload.
        "pod-security.kubernetes.io/enforce":
          TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT,
        "pod-security.kubernetes.io/audit": "baseline",
        "pod-security.kubernetes.io/warn": "baseline",
      },
      ...(retained ? { annotations: retainedResourceAnnotations() } : {}),
    },
  });
}
