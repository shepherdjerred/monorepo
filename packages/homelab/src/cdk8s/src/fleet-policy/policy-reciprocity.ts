import {
  selectorMatches,
  type Fleet,
  type FleetNetworkPolicy,
  type FleetPolicyPort,
  type LabelSelector,
  type PolicyType,
} from "./fleet.ts";
import {
  namespaceNamedBy,
  podsLabelled,
  podsOf,
  policiesAllow,
  policiesSelecting,
  type Pods,
} from "./network-reachability.ts";

/**
 * Cross-namespace reciprocity: a connection one namespace's policy opens is
 * also opened by the policy on its other end.
 *
 * A connection between two policed pods needs the source's Egress policy and
 * the destination's Ingress policy to both allow it. A rule naming a peer
 * namespace whose own policy does not answer it is either a connection that
 * does not work or a rule that grants nothing.
 */

/** The pods one side of a rule names, and whether NetworkPolicy binds them. */
type Party = { pods: Pods; policed: boolean };

/**
 * The label sets a selector requires: its matchLabels, once per combination
 * of the values its `In` expressions list.
 */
function labelSetsRequiredBy(
  selector: LabelSelector,
): Readonly<Record<string, string>>[] {
  return (selector.matchExpressions ?? [])
    .filter(({ operator }) => operator === "In")
    .reduce<Readonly<Record<string, string>>[]>(
      (sets, { key, values = [] }) =>
        sets.flatMap((labels) =>
          values.map((value) => ({ ...labels, [key]: value })),
        ),
      [selector.matchLabels ?? {}],
    );
}

/**
 * The pods a selector names in a namespace: the synthesized workloads it
 * matches, or, when it matches none, pods rendered elsewhere (an upstream
 * chart, an operator, a CI step), known only by the labels the selector
 * requires.
 */
function partiesNamedBy(
  fleet: Fleet,
  namespace: string,
  selector: LabelSelector,
): Party[] {
  const workloads = fleet.workloads.filter(
    (workload) =>
      workload.namespace === namespace &&
      selectorMatches(selector, workload.podLabels),
  );
  return workloads.length === 0
    ? labelSetsRequiredBy(selector).map((labels) => ({
        pods: podsLabelled(namespace, labels),
        policed: true,
      }))
    : workloads.map((workload) => ({
        pods: podsOf(workload),
        // NetworkPolicy does not apply to host-network pods.
        policed: !workload.hostNetwork,
      }));
}

function describePort(port: FleetPolicyPort | undefined): string {
  if (port === undefined) return "*";
  const range =
    port.endPort === undefined
      ? String(port.port ?? "*")
      : `${String(port.port)}-${String(port.endPort)}`;
  return port.protocol === "TCP" ? range : `${range}/${port.protocol}`;
}

function describePeer(namespace: string, selector: LabelSelector): string {
  const labels = Object.entries(selector.matchLabels ?? {}).map(
    ([key, value]) => `${key}=${value}`,
  );
  const expressions = (selector.matchExpressions ?? []).map(
    ({ key, operator }) => `${key} ${operator}`,
  );
  const terms = [...labels, ...expressions];
  return terms.length === 0 ? namespace : `${namespace}{${terms.join(",")}}`;
}

/**
 * Whether the peer's side answers one rule of `policy`: some pod the peer
 * names is either bound by no policy of the opposite type, or bound by one
 * that allows a pod `policy` selects on the port.
 *
 * Both sides are judged by "some pod" because a rule and a selector name a
 * set: a namespace-wide peer is reciprocated by the one workload it is meant
 * for, not by every workload that happens to share the namespace.
 */
function reciprocated(
  fleet: Fleet,
  type: PolicyType,
  rule: {
    subjects: readonly Party[];
    peers: readonly Party[];
    port: FleetPolicyPort | undefined;
  },
): boolean {
  const opposite = type === "Egress" ? "Ingress" : "Egress";
  return rule.peers.some((peer) => {
    if (!peer.policed) return true;
    const policies = policiesSelecting(fleet, opposite, peer.pods);
    return (
      policies.length === 0 ||
      rule.subjects.some((subject) =>
        policiesAllow(policies, opposite, {
          peer: subject.pods,
          port: rule.port,
          destination: type === "Egress" ? peer.pods : subject.pods,
        }),
      )
    );
  });
}

function unreciprocatedRulesOf(
  fleet: Fleet,
  policy: FleetNetworkPolicy,
  type: PolicyType,
): string[] {
  const subjects = partiesNamedBy(fleet, policy.namespace, policy.podSelector);
  const arrow = type === "Egress" ? "->" : "<-";
  const rules = type === "Egress" ? policy.egress : policy.ingress;
  return rules.flatMap((rule) =>
    (rule.peers ?? []).flatMap((peer) => {
      const namespace = namespaceNamedBy(peer);
      if (namespace === undefined || namespace === policy.namespace) return [];
      const selector = peer.podSelector ?? {};
      const peers = partiesNamedBy(fleet, namespace, selector);
      return (rule.ports ?? [undefined])
        .filter((port) => !reciprocated(fleet, type, { subjects, peers, port }))
        .map(
          (port) =>
            `${policy.namespace}/${policy.name} ${arrow} ${describePeer(namespace, selector)}:${describePort(port)}`,
        );
    }),
  );
}

/**
 * Rules of one policy type that name another namespace whose policies do not
 * answer them, each once:
 *
 * - Egress, as `<namespace>/<policy> -> <peer>:<port>`: the peer's Ingress
 *   policy does not admit the policy's pods on the port.
 * - Ingress, as `<namespace>/<policy> <- <peer>:<port>`: the peer's Egress
 *   policy does not let it reach the policy's pods on the port.
 *
 * `<peer>` is the namespace, followed by the pod selector when the rule has
 * one. A peer bound by no policy of the answering type is the policy-coverage
 * rules' concern and is not reported here. Rules that select namespaces by
 * anything but their name, and ipBlock peers, name no namespace and are
 * skipped.
 */
export function unreciprocatedRules(fleet: Fleet, type: PolicyType): string[] {
  return [
    ...new Set(
      fleet.networkPolicies
        .filter((policy) => policy.policyTypes.includes(type))
        .flatMap((policy) => unreciprocatedRulesOf(fleet, policy, type)),
    ),
  ];
}
