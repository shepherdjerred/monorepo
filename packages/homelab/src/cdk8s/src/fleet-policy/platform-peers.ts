import { KUBERNETES_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  POSTGRES_OPERATOR_CLUSTER_LABELS,
  postgresClusterPodLabels,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import type { Fleet, FleetPolicyPort, FleetPolicyRule } from "./fleet.ts";
import {
  podsLabelled,
  policiesAllow,
  policiesSelecting,
  portsCover,
  type Pods,
} from "./network-reachability.ts";

/**
 * Rules about peers that are not ordinary pods of a namespace this
 * repository synthesizes: the Kubernetes API server, reached by address, and
 * the postgres-operator, which reaches into every database namespace.
 */

const EVERY_ADDRESS: ReadonlySet<string> = new Set(["0.0.0.0/0", "::/0"]);
const NO_NAMED_PORTS: ReadonlyMap<string, number> = new Map();

function tcpPort(port: number): FleetPolicyPort {
  return { protocol: "TCP", port, endPort: undefined };
}

/**
 * Egress rules that name the API server's port and an address other than the
 * one it advertises, as `<namespace>/<policy> -> <cidr>:<port>`.
 *
 * A pod reaches the API server through the `kubernetes` Service, and
 * NetworkPolicy sees the connection after DNAT: to the control-plane node's
 * InternalIP, which here is its Tailscale address. A rule that names the
 * node's LAN address admits nothing. Rules without an address, or open to
 * every address, are not meant for the API server alone and are skipped.
 */
export function apiServerRulesOffEndpoint(fleet: Fleet): string[] {
  const { cidr, port } = KUBERNETES_API_ENDPOINT;
  return fleet.networkPolicies.flatMap((policy) =>
    policy.egress
      .filter(
        (rule) =>
          rule.ports !== undefined &&
          portsCover(rule.ports, tcpPort(port), NO_NAMED_PORTS),
      )
      .flatMap((rule) => rule.peers ?? [])
      .flatMap((peer) => (peer.ipBlock === undefined ? [] : [peer.ipBlock]))
      .filter((block) => !EVERY_ADDRESS.has(block.cidr) && block.cidr !== cidr)
      .map(
        (block) =>
          `${policy.namespace}/${policy.name} -> ${block.cidr}:${String(port)}`,
      ),
  );
}

/** SQL, and Patroni's REST API. */
const POSTGRES_OPERATOR_PORTS = [5432, 8008] as const;

/**
 * The postgres-operator clusters of the fleet and their pods, known by the
 * labels the operator stamps on them.
 */
function postgresClusters(
  fleet: Fleet,
): { namespace: string; name: string; pods: Pods }[] {
  return fleet.objects
    .filter(
      (object) =>
        object.kind === "postgresql" &&
        object.apiVersion.startsWith("acid.zalan.do/"),
    )
    .flatMap(({ metadata: { namespace, name } }) =>
      namespace === undefined
        ? []
        : [
            {
              namespace,
              name,
              pods: podsLabelled(namespace, {
                ...POSTGRES_OPERATOR_CLUSTER_LABELS,
                ...postgresClusterPodLabels(name),
              }),
            },
          ],
    );
}

/**
 * Whether an Egress rule reaches the API server: it opens the API server's
 * port to every address or to the one the API server advertises.
 */
function reachesApiServer(rule: FleetPolicyRule): boolean {
  const { cidr, port } = KUBERNETES_API_ENDPOINT;
  return (
    portsCover(rule.ports, tcpPort(port), NO_NAMED_PORTS) &&
    (rule.peers === undefined ||
      rule.peers.some(
        ({ ipBlock }) =>
          ipBlock !== undefined &&
          (ipBlock.cidr === cidr || EVERY_ADDRESS.has(ipBlock.cidr)) &&
          !(ipBlock.except ?? []).includes(cidr),
      ))
  );
}

/**
 * postgres-operator clusters whose pods an Egress policy selects without
 * letting them reach the Kubernetes API server, as `<namespace>/<cluster>`.
 * Patroni keeps its leader lease and cluster state in the API server; a
 * policy written for an app that also binds the database pods cuts it off.
 * Prefer selecting the app's pods alone, which leaves the cluster unpoliced.
 */
export function postgresClustersWithoutApiServer(fleet: Fleet): string[] {
  return postgresClusters(fleet)
    .filter(({ pods }) => {
      const policies = policiesSelecting(fleet, "Egress", pods);
      return (
        policies.length > 0 &&
        !policies.some((policy) =>
          policy.egress.some((rule) => reachesApiServer(rule)),
        )
      );
    })
    .map(({ namespace, name }) => `${namespace}/${name}`);
}

/**
 * postgres-operator clusters whose pods an Ingress policy selects without
 * admitting the operator, as `<namespace>/<cluster>:<port>`. The operator
 * syncs roles and databases over SQL and drives Patroni over its REST API, so
 * a policy that shuts it out leaves the cluster unmanaged.
 */
export function postgresClustersClosedToOperator(fleet: Fleet): string[] {
  const operator = podsLabelled("postgres-operator");
  return postgresClusters(fleet).flatMap(({ namespace, name, pods }) => {
    const policies = policiesSelecting(fleet, "Ingress", pods);
    if (policies.length === 0) return [];
    return POSTGRES_OPERATOR_PORTS.filter(
      (port) =>
        !policiesAllow(policies, "Ingress", {
          peer: operator,
          port: tcpPort(port),
          destination: pods,
        }),
    ).map((port) => `${namespace}/${name}:${String(port)}`);
  });
}
