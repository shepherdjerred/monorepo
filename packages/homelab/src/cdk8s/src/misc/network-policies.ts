import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * Egress rules that recur verbatim across namespace NetworkPolicies.
 *
 * Nearly every workload needs cluster DNS, and most that talk to anything
 * outside the cluster need HTTPS to an unenumerable destination. Written out
 * inline these are the single most duplicated block in the chart tree, so they
 * live here as functions rather than as a shape each chart retypes.
 *
 * Each returns a fresh object: a NetworkPolicy spec is mutated during synth, so
 * handing the same literal to two charts would let one chart's rendering affect
 * the other's.
 */

/**
 * Cluster DNS (kube-dns), UDP and TCP on 53.
 *
 * The namespaceSelector is deliberately empty — kube-dns lives in kube-system
 * and every namespace needs to reach it, so this matches the pod by label
 * wherever it runs rather than pinning a namespace name.
 */
export function dnsEgressRule() {
  return {
    to: [
      {
        namespaceSelector: {},
        podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
      },
    ],
    ports: [
      { port: IntOrString.fromNumber(53), protocol: "UDP" },
      { port: IntOrString.fromNumber(53), protocol: "TCP" },
    ],
  };
}

/**
 * Outbound HTTPS to anywhere.
 *
 * Broad by necessity: the destinations are third-party APIs and CDNs whose
 * address ranges cannot be enumerated ahead of time. Callers that can name
 * their destination should write a narrower rule instead of reaching for this.
 */
export function externalHttpsEgressRule() {
  return {
    to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
    ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
  };
}
