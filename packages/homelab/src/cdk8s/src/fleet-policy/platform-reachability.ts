import { z } from "zod";
import {
  selectorMatches,
  type Fleet,
  type FleetNetworkPolicy,
} from "./fleet.ts";
import {
  podsLabelled,
  podsOf,
  policiesAllow,
  policiesSelecting,
  type Pods,
} from "./network-reachability.ts";
import {
  servicePortTargets,
  TailscaleIngressSchema,
  tailscaleProxyPods,
} from "./probe-admission.ts";

/**
 * Reachability of the two platform peers a policed pod depends on without
 * naming them in its configuration: the Tailscale proxy that fronts its
 * tailnet route, and cluster DNS.
 */

const IngressClassSchema = z.looseObject({
  spec: z.looseObject({ ingressClassName: z.string().optional() }),
});

/**
 * Tailscale Ingress backends whose pods an Ingress policy selects without
 * admitting the proxy, as `<namespace>/<ingress> -> <service>:<port>`.
 *
 * The Tailscale operator serves each Ingress from a proxy pod in the
 * `tailscale` namespace, and that pod's address is the source the backend
 * sees. The probe-admission rule checks the same peer, but only for an
 * Ingress that registered a blackbox probe; this one also covers an Ingress
 * that opted out of its probe. Pods no Ingress policy selects accept every
 * connection and are not reported.
 */
export function tailscaleBackendsNotAdmitted(fleet: Fleet): string[] {
  return fleet.objects
    .filter(
      (object) =>
        object.kind === "Ingress" &&
        IngressClassSchema.parse(object).spec.ingressClassName === "tailscale",
    )
    .flatMap((ingress) => {
      const { namespace, name } = ingress.metadata;
      if (namespace === undefined)
        throw new Error(`Tailscale Ingress ${name} has no namespace`);
      const { service } =
        TailscaleIngressSchema.parse(ingress).spec.defaultBackend;
      const closed = servicePortTargets(fleet, {
        namespace,
        serviceName: service.name,
        port: service.port.number,
      }).some(({ pods, port }) => {
        const destination = pods ?? podsLabelled(namespace);
        const policies = policiesSelecting(fleet, "Ingress", destination);
        return (
          policies.length > 0 &&
          !policiesAllow(policies, "Ingress", {
            peer: tailscaleProxyPods(namespace, name),
            port: { protocol: "TCP", port, endPort: undefined },
            destination,
          })
        );
      });
      return closed
        ? [
            `${namespace}/${name} -> ${service.name}:${String(service.port.number)}`,
          ]
        : [];
    });
}

/** CoreDNS, by the label `dnsEgressRule` selects it with. */
const CLUSTER_DNS = podsLabelled("kube-system", { "k8s-app": "kube-dns" });
const DNS_PORT = 53;
const DNS_PROTOCOLS = ["UDP", "TCP"] as const;

/** The DNS protocols the Egress policies selecting the pods leave closed. */
function dnsProtocolsClosed(fleet: Fleet, pods: Pods): string[] {
  const policies = policiesSelecting(fleet, "Egress", pods);
  if (policies.length === 0) return [];
  return DNS_PROTOCOLS.filter(
    (protocol) =>
      !policiesAllow(policies, "Egress", {
        peer: CLUSTER_DNS,
        port: { protocol, port: DNS_PORT, endPort: undefined },
        destination: CLUSTER_DNS,
      }),
  );
}

function selectsSomeWorkload(fleet: Fleet, policy: FleetNetworkPolicy) {
  return fleet.workloads.some(
    (workload) =>
      workload.namespace === policy.namespace &&
      !workload.hostNetwork &&
      selectorMatches(policy.podSelector, workload.podLabels),
  );
}

/**
 * Pods an Egress policy selects that cannot reach cluster DNS, as
 * `<namespace>/<workload>:53/<protocol>`.
 *
 * A pod resolves every Service name through CoreDNS in `kube-system`, over
 * UDP and, for an answer too large for it, TCP. NetworkPolicy sees the
 * connection after the `kube-dns` Service's DNAT, so the peer is the CoreDNS
 * pod on 53. An Egress policy that omits it leaves the pod unable to resolve
 * any name, which looks like every dependency failing at once.
 *
 * Pods synthesis cannot see (an upstream chart's, an operator's, a CI
 * step's) are known only by the labels a policy selects them by. An Egress
 * policy that selects no synthesized workload is therefore checked against
 * its own selector, as `<namespace>/policy:<policy>:53/<protocol>`: a policy
 * that selects the same pods by other labels is not counted for them.
 */
export function egressPodsWithoutDns(fleet: Fleet): string[] {
  const workloads = fleet.workloads
    .filter((workload) => !workload.hostNetwork)
    .flatMap((workload) =>
      dnsProtocolsClosed(fleet, podsOf(workload)).map(
        (protocol) => `${workload.key}:${String(DNS_PORT)}/${protocol}`,
      ),
    );
  const unseen = fleet.networkPolicies
    .filter(
      (policy) =>
        policy.policyTypes.includes("Egress") &&
        !selectsSomeWorkload(fleet, policy),
    )
    .flatMap((policy) =>
      dnsProtocolsClosed(
        fleet,
        podsLabelled(policy.namespace, policy.podSelector.matchLabels ?? {}),
      ).map(
        (protocol) =>
          `${policy.namespace}/policy:${policy.name}:${String(DNS_PORT)}/${protocol}`,
      ),
    );
  return [...new Set([...workloads, ...unseen])];
}
