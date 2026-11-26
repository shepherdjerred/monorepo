import type { Chart } from "cdk8s";
import type { DaemonSet } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * The NetworkPolicy of each host metrics collector DaemonSet.
 *
 * A collector writes a `.prom` file into node-exporter's textfile directory on
 * the host and listens on nothing, so no Ingress rule is needed: Prometheus
 * scrapes node-exporter, not the collector. Its only connections are the
 * `apk add` and `pip install` its container runs at start, to the Alpine CDN
 * and PyPI over HTTPS. The pods use the pod network, not the host's, so the
 * policy binds them.
 */
export function createHostCollectorNetworkPolicies(
  chart: Chart,
  daemonSets: readonly DaemonSet[],
) {
  return daemonSets.map((daemonSet) => {
    const name = `${daemonSet.name}-netpol`;
    return new KubeNetworkPolicy(chart, name, {
      metadata: { name, namespace: "prometheus" },
      spec: {
        podSelector: { matchLabels: daemonSet.matchLabels },
        policyTypes: ["Ingress", "Egress"],
        ingress: [],
        egress: [dnsEgressRule(), externalHttpsEgressRule()],
      },
    });
  });
}
