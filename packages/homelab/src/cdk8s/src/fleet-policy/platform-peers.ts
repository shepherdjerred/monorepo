import { KUBERNETES_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import type { Fleet, FleetPolicyPort } from "./fleet.ts";
import {
  podsLabelled,
  policiesAllow,
  policiesSelecting,
  portsCover,
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
 * postgres-operator clusters whose pods an Ingress policy selects without
 * admitting the operator, as `<namespace>/<cluster>:<port>`. The operator
 * syncs roles and databases over SQL and drives Patroni over its REST API, so
 * a policy that shuts it out leaves the cluster unmanaged.
 */
export function postgresClustersClosedToOperator(fleet: Fleet): string[] {
  const operator = podsLabelled("postgres-operator");
  return fleet.objects
    .filter(
      (object) =>
        object.kind === "postgresql" &&
        object.apiVersion.startsWith("acid.zalan.do/"),
    )
    .flatMap(({ metadata: { namespace, name } }) => {
      if (namespace === undefined) return [];
      const pods = podsLabelled(namespace, postgresClusterPodLabels(name));
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
