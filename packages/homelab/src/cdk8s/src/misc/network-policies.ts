import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { PROD_NODE_INTERNAL_IP } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";

/**
 * Peers, ports and whole rules that recur verbatim across namespace
 * NetworkPolicies.
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
 * The home LAN. Traffic that reaches a pod through a `hostPort` or a NodePort
 * Service with `externalTrafficPolicy: Local` keeps the client's address, so
 * an Ingress policy on such a pod has to admit the clients by address.
 */
const HOME_LAN_CIDR = "192.168.1.0/24";

/** Every device on the home LAN, for a pod LAN clients connect to directly. */
export function homeLanPeer() {
  return { ipBlock: { cidr: HOME_LAN_CIDR } };
}

/** Every pod in the named namespace. */
export function nsPeer(name: string) {
  return {
    namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
  };
}

/** One TCP port. */
export function tcp(port: number) {
  return { port: IntOrString.fromNumber(port), protocol: "TCP" };
}

/** One UDP port, or with `endPort` the inclusive range that starts at it. */
export function udp(port: number, endPort?: number) {
  return {
    port: IntOrString.fromNumber(port),
    protocol: "UDP",
    ...(endPort === undefined ? {} : { endPort }),
  };
}

function namespaceIngressRule(namespace: string, ports?: readonly number[]) {
  return ports === undefined
    ? { from: [nsPeer(namespace)] }
    : { from: [nsPeer(namespace)], ports: ports.map((port) => tcp(port)) };
}

/**
 * Traffic from the Tailscale operator's ingress proxies, which run in the
 * `tailscale` namespace. Without `ports` the rule admits every port, which is
 * what the older charts render; name the ports for anything new.
 */
export function tailscaleIngressRule(ports?: readonly number[]) {
  return namespaceIngressRule("tailscale", ports);
}

/**
 * The namespace cloudflared, the public edge, runs in. The Cloudflare operator
 * creates the tunnel Deployment beside itself; the `cloudflare-tunnel`
 * namespace only holds the `ClusterTunnel` Application and has no pods.
 */
const CLOUDFLARE_TUNNEL_NAMESPACE = "cloudflare-operator-system";

/** The cloudflared pods, for a rule that also names other peers. */
export function cloudflareTunnelPeer() {
  return nsPeer(CLOUDFLARE_TUNNEL_NAMESPACE);
}

/** Traffic from cloudflared, the public edge. */
export function cloudflareTunnelIngressRule(ports?: readonly number[]) {
  return namespaceIngressRule(CLOUDFLARE_TUNNEL_NAMESPACE, ports);
}

/**
 * The in-cluster health probe from blackbox-exporter. It runs in the
 * `prometheus` namespace, so this renders the same rule as
 * `prometheusIngressRule`; the separate name records that the port is opened
 * for a probe of the serving port rather than a metrics scrape.
 */
export function blackboxProbeIngressRule(port: number) {
  return namespaceIngressRule("prometheus", [port]);
}

/**
 * Traffic from every pod of the policy's own namespace, on every port.
 */
export function intraNamespaceRule() {
  return { from: [{ podSelector: {} }] };
}

/** Flag evaluation against Flipt (`flipt-flipt-service.flipt`, HTTP 8080). */
export function fliptEgress() {
  return { to: [nsPeer("flipt")], ports: [tcp(8080)] };
}

/** OTLP/HTTP to the trace gateway (`alloy-gateway.alloy-gateway`, 4318). */
export function otlpEgress() {
  return { to: [nsPeer("alloy-gateway")], ports: [tcp(4318)] };
}

/** The SeaweedFS S3 gateway (`seaweedfs-s3.seaweedfs`, 8333). */
export function seaweedfsEgress() {
  return { to: [nsPeer("seaweedfs")], ports: [tcp(8333)] };
}

/**
 * The pods of one postgres-operator cluster in the policy's own namespace,
 * selected by the operator's cluster-name label.
 */
export function postgresEgress(cluster: string) {
  return {
    to: [{ podSelector: { matchLabels: postgresClusterPodLabels(cluster) } }],
    ports: [tcp(5432)],
  };
}

/**
 * The postgres-operator managing a cluster it created. It connects to the
 * database pods from its own namespace: SQL on 5432 to sync roles and
 * databases, and Patroni's REST API on 8008 for status, configuration and
 * switchover. Every Ingress policy on a cluster's pods needs this rule.
 */
export function postgresOperatorIngressRule() {
  return {
    from: [nsPeer("postgres-operator")],
    ports: [tcp(5432), tcp(8008)],
  };
}

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

/** The address and port the `kubernetes` Service's Endpoints advertise. */
export const KUBERNETES_API_ENDPOINT = {
  cidr: `${PROD_NODE_INTERNAL_IP}/32`,
  port: 6443,
} as const;

/**
 * The Kubernetes API server, as a pod's connection to the `kubernetes`
 * Service looks after DNAT.
 *
 * NetworkPolicy is evaluated against the translated destination, which is the
 * address the API server advertises in the `kubernetes` Endpoints: the
 * control-plane node's InternalIP. Here that is the node's Tailscale address,
 * not its LAN address, so the rule takes it from the node registry.
 */
export function kubernetesApiEgressRule() {
  return {
    to: [{ ipBlock: { cidr: KUBERNETES_API_ENDPOINT.cidr } }],
    ports: [tcp(KUBERNETES_API_ENDPOINT.port)],
  };
}

/** Metrics scraped by Prometheus from explicitly named workload ports. */
export function prometheusIngressRule(ports: readonly number[]) {
  return namespaceIngressRule("prometheus", ports);
}

/**
 * The name of the one staging policy a namespace with policies carries. It
 * includes the namespace because the root chart renders policies into several
 * namespaces and `release-root` identifies a root object by group, kind and
 * name alone.
 */
export function enforcementStagingPolicyName(namespace: string): string {
  return `enforcement-staging-${namespace}`;
}

/** A label no pod carries: the selector of a cut-over staging policy. */
export const ENFORCEMENT_STAGING_NEVER_LABEL = {
  "homelab.sjer.red/enforcement-staging": "never",
} as const;

/**
 * Where a namespace stands on NetworkPolicy enforcement: `open` while its
 * staging policy still allows everything, `enforced` once only its real
 * policies decide.
 */
export type EnforcementStage = "open" | "enforced";

/**
 * The staging policy of one namespace: allow everything, both ways.
 *
 * NetworkPolicies are additive, so while this selects every pod (`open`) the
 * namespace behaves as if nothing were enforced, whatever its other policies
 * say. `enforced` points the selector at a label no pod carries, which leaves
 * the real policies in charge. Only the selector differs between the stages,
 * so cutting a namespace over and reverting it are in-place updates of one
 * object and never wait on a prune.
 */
export function enforcementStagingPolicy(
  chart: Chart,
  namespace: string,
  stage: EnforcementStage,
) {
  const name = enforcementStagingPolicyName(namespace);
  return new KubeNetworkPolicy(chart, name, {
    metadata: {
      name,
      namespace,
      annotations: {
        "homelab.sjer.red/enforcement-stage": stage,
        "homelab.sjer.red/description":
          "Enforcement staging: allows all traffic for every pod while the stage is open, and selects no pod once it is enforced. Wiki how-to/cut-a-namespace-over-to-enforced-policies.",
      },
    },
    spec: {
      podSelector:
        stage === "open"
          ? {}
          : { matchLabels: { ...ENFORCEMENT_STAGING_NEVER_LABEL } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{}],
      egress: [{}],
    },
  });
}
