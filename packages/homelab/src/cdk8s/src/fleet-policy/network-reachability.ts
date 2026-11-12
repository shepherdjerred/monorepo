import {
  selectorMatches,
  type Fleet,
  type FleetNetworkPolicy,
  type FleetPolicyPort,
  type FleetPolicyRule,
  type FleetWorkload,
  type NetworkPolicyPeer,
  type PolicyType,
} from "./fleet.ts";

/**
 * NetworkPolicy semantics shared by the reachability rules: which policies
 * select a group of pods, and whether those policies let a peer through on a
 * port.
 */

const NAMESPACE_NAME_LABEL = "kubernetes.io/metadata.name";

/**
 * A group of pods as a policy sees it. For a synthesized workload the labels
 * are its pod labels. For pods an upstream chart renders they are the labels
 * some policy names them by, which is a subset of what the pods carry.
 */
export type Pods = {
  namespace: string;
  labels: Readonly<Record<string, string>>;
  /** Container port numbers by name, to resolve a named policy port. */
  namedPorts: ReadonlyMap<string, number>;
};

const EVERY_ADDRESS: ReadonlySet<string> = new Set(["0.0.0.0/0", "::/0"]);
const NO_NAMED_PORTS: ReadonlyMap<string, number> = new Map();

export function podsOf(workload: FleetWorkload): Pods {
  return {
    namespace: workload.namespace,
    labels: workload.podLabels,
    namedPorts: new Map(
      workload.containers.flatMap(({ spec }) =>
        (spec.ports ?? []).flatMap(({ name, containerPort }) =>
          name === undefined ? [] : [[name, containerPort] as const],
        ),
      ),
    ),
  };
}

/** Pods known only by their namespace and the labels a selector names. */
export function podsLabelled(
  namespace: string,
  labels: Readonly<Record<string, string>> = {},
): Pods {
  return { namespace, labels, namedPorts: NO_NAMED_PORTS };
}

/** The namespace a peer names by its `kubernetes.io/metadata.name` label. */
export function namespaceNamedBy(peer: NetworkPolicyPeer): string | undefined {
  return peer.namespaceSelector?.matchLabels?.[NAMESPACE_NAME_LABEL];
}

/**
 * Whether a rule peer selects the pods. A peer without a namespaceSelector
 * means the policy's own namespace. Namespaces are known here only by name,
 * which is the one namespace label the fleet's policies select on. An ipBlock
 * names addresses, and synthesis knows no pod's, so it selects pods only when
 * it covers every address.
 */
export function peerSelects(
  peer: NetworkPolicyPeer,
  policyNamespace: string,
  pods: Pods,
): boolean {
  if (peer.ipBlock !== undefined)
    return (
      EVERY_ADDRESS.has(peer.ipBlock.cidr) &&
      (peer.ipBlock.except ?? []).length === 0
    );
  const namespaceMatches =
    peer.namespaceSelector === undefined
      ? pods.namespace === policyNamespace
      : selectorMatches(peer.namespaceSelector, {
          [NAMESPACE_NAME_LABEL]: pods.namespace,
        });
  return (
    namespaceMatches && selectorMatches(peer.podSelector ?? {}, pods.labels)
  );
}

function portBounds(
  port: FleetPolicyPort,
  namedPorts: ReadonlyMap<string, number>,
): { low: number | string; high: number | string } | undefined {
  if (port.port === undefined) return undefined;
  const low =
    typeof port.port === "string"
      ? (namedPorts.get(port.port) ?? port.port)
      : port.port;
  return { low, high: port.endPort ?? low };
}

/**
 * Whether a rule's ports cover the wanted one. `wanted` absent asks only that
 * the rule opens some port. A named port resolves against the destination
 * pods; one that does not resolve is compared by name.
 */
export function portsCover(
  allowed: readonly FleetPolicyPort[] | undefined,
  wanted: FleetPolicyPort | undefined,
  namedPorts: ReadonlyMap<string, number>,
): boolean {
  if (allowed === undefined || wanted === undefined) return true;
  const want = portBounds(wanted, namedPorts);
  return allowed.some((port) => {
    if (port.protocol !== wanted.protocol) return false;
    const have = portBounds(port, namedPorts);
    if (have === undefined) return true;
    if (want === undefined) return false;
    return typeof have.low === "number" && typeof want.low === "number"
      ? have.low <= want.low && want.high <= have.high
      : have.low === want.low;
  });
}

/** The policies of one type that select the pods. */
export function policiesSelecting(
  fleet: Fleet,
  type: PolicyType,
  pods: Pods,
): FleetNetworkPolicy[] {
  return fleet.networkPolicies.filter(
    (policy) =>
      policy.namespace === pods.namespace &&
      policy.policyTypes.includes(type) &&
      selectorMatches(policy.podSelector, pods.labels),
  );
}

function rulesOf(
  policy: FleetNetworkPolicy,
  type: PolicyType,
): readonly FleetPolicyRule[] {
  return type === "Ingress" ? policy.ingress : policy.egress;
}

/**
 * Whether any of the policies lets the peer through on the port: inbound from
 * it for Ingress, outbound to it for Egress. The port is always a port of the
 * connection's destination, whose named ports resolve it.
 */
export function policiesAllow(
  policies: readonly FleetNetworkPolicy[],
  type: PolicyType,
  connection: {
    peer: Pods;
    port: FleetPolicyPort | undefined;
    destination: Pods;
  },
): boolean {
  return policies.some((policy) =>
    rulesOf(policy, type).some(
      (rule) =>
        (rule.peers === undefined ||
          rule.peers.some((peer) =>
            peerSelects(peer, policy.namespace, connection.peer),
          )) &&
        portsCover(
          rule.ports,
          connection.port,
          connection.destination.namedPorts,
        ),
    ),
  );
}
