import {
  selectorMatches,
  type Fleet,
  type FleetPolicyPort,
  type FleetService,
  type FleetWorkload,
} from "./fleet.ts";
import {
  podsLabelled,
  podsOf,
  policiesAllow,
  policiesSelecting,
  type Pods,
} from "./network-reachability.ts";

/**
 * Connections a workload's rendered environment says it opens, checked
 * against the NetworkPolicies on both ends.
 *
 * A literal env value that names an in-cluster Service with a port
 * (`http://flipt.flipt:8080`, `temporal-server:7233`) is a connection the
 * container is configured to make. It is resolved the way kube-proxy resolves
 * it, to the Service's backend pods and target port, because NetworkPolicy
 * matches the pod and its port, never the Service.
 */

/** Pods an upstream Helm chart renders, which synthesis cannot see. */
type UpstreamBackend = {
  namespace: string;
  service: string;
  /** Pod port by Service port. */
  ports: ReadonlyMap<number, number>;
  labels: Readonly<Record<string, string>>;
};

/**
 * Services of upstream charts that first-party workloads are configured
 * against. The chart renders the Service and its pods, so their labels and
 * ports are recorded here; no policy in this repository selects these pods.
 */
const UPSTREAM_BACKENDS: readonly UpstreamBackend[] = [
  {
    namespace: "seaweedfs",
    service: "seaweedfs-s3",
    ports: new Map([[8333, 8333]]),
    labels: {
      "app.kubernetes.io/name": "seaweedfs",
      "app.kubernetes.io/instance": "seaweedfs",
      "app.kubernetes.io/component": "s3",
    },
  },
];

const DEFAULT_PORT_OF_SCHEME: Readonly<Record<string, number>> = {
  http: 80,
  https: 443,
};

/** `[scheme://]host[:port]` wherever it occurs in an env value. */
const ENDPOINT =
  /(?:([a-z][a-z0-9+]*):\/\/)?([a-z0-9][a-z0-9.-]*)(?::(\d{1,5}))?/g;

type Endpoint = { host: string; port: number };

function endpointsIn(value: string): Endpoint[] {
  return [...value.matchAll(ENDPOINT)].flatMap(
    ([, scheme = "", host, port]) => {
      if (host === undefined) return [];
      const number =
        port === undefined
          ? DEFAULT_PORT_OF_SCHEME[scheme]
          : Number.parseInt(port, 10);
      return number === undefined ? [] : [{ host, port: number }];
    },
  );
}

/**
 * The namespace and Service a host names from a pod in `namespace`:
 * `service`, `service.namespace`, or either cluster-domain form.
 */
function serviceNamedBy(
  host: string,
  namespace: string,
): { namespace: string; service: string } | undefined {
  const [service, serviceNamespace, ...domain] = host.split(".");
  if (service === undefined) return undefined;
  return ["", "svc", "svc.cluster.local"].includes(domain.join("."))
    ? { namespace: serviceNamespace ?? namespace, service }
    : undefined;
}

/** One backend a configured connection reaches. */
type Backend = { pods: Pods; port: FleetPolicyPort; policed: boolean };

function backendsOfService(
  fleet: Fleet,
  service: FleetService,
  port: number,
): Backend[] {
  const { selector } = service;
  const servicePort = service.ports.find(
    (candidate) => candidate.port === port,
  );
  if (selector === undefined || servicePort === undefined) return [];
  return fleet.workloads
    .filter(
      (workload) =>
        workload.namespace === service.namespace &&
        selectorMatches({ matchLabels: selector }, workload.podLabels),
    )
    .map((workload) => ({
      pods: podsOf(workload),
      port: {
        protocol: servicePort.protocol,
        port: servicePort.targetPort ?? servicePort.port,
        endPort: undefined,
      },
      // NetworkPolicy does not apply to host-network pods.
      policed: !workload.hostNetwork,
    }));
}

function backendsOf(
  fleet: Fleet,
  target: { namespace: string; service: string },
  port: number,
): Backend[] {
  const upstream = UPSTREAM_BACKENDS.find(
    (backend) =>
      backend.namespace === target.namespace &&
      backend.service === target.service,
  );
  const podPort = upstream?.ports.get(port);
  if (upstream !== undefined && podPort !== undefined)
    return [
      {
        pods: podsLabelled(upstream.namespace, upstream.labels),
        port: { protocol: "TCP", port: podPort, endPort: undefined },
        policed: true,
      },
    ];
  return fleet.services
    .filter(
      (service) =>
        service.namespace === target.namespace &&
        service.name === target.service,
    )
    .flatMap((service) => backendsOfService(fleet, service, port));
}

/** A connection one workload is configured to open to a Service. */
export type ConfiguredConnection = {
  client: FleetWorkload;
  /** The env variable that names the endpoint. */
  env: string;
  /** `<namespace>/<service>:<port>`, the Service port as configured. */
  target: string;
  backends: readonly Backend[];
};

/**
 * Every connection the fleet's literal env values configure to a Service
 * whose backend pods are known: synthesized here, or listed in
 * `UPSTREAM_BACKENDS`. Values from Secrets and ConfigMaps, endpoints built in
 * application code, and a host whose port lives in a separate variable are
 * not visible here.
 */
export function configuredConnections(fleet: Fleet): ConfiguredConnection[] {
  return fleet.workloads
    .filter((workload) => !workload.hostNetwork)
    .flatMap((client) =>
      client.containers.flatMap(({ spec }) =>
        (spec.env ?? []).flatMap(({ name, value = "" }) =>
          endpointsIn(value).flatMap(({ host, port }) => {
            const target = serviceNamedBy(host, client.namespace);
            if (target === undefined) return [];
            const backends = backendsOf(fleet, target, port);
            return backends.length === 0
              ? []
              : [
                  {
                    client,
                    env: name,
                    target: `${target.namespace}/${target.service}:${String(port)}`,
                    backends,
                  },
                ];
          }),
        ),
      ),
    );
}

function egressAllows(fleet: Fleet, client: Pods, backend: Backend): boolean {
  const policies = policiesSelecting(fleet, "Egress", client);
  return (
    policies.length === 0 ||
    policiesAllow(policies, "Egress", {
      peer: backend.pods,
      port: backend.port,
      destination: backend.pods,
    })
  );
}

function ingressAllows(fleet: Fleet, client: Pods, backend: Backend): boolean {
  if (!backend.policed) return true;
  const policies = policiesSelecting(fleet, "Ingress", backend.pods);
  return (
    policies.length === 0 ||
    policiesAllow(policies, "Ingress", {
      peer: client,
      port: backend.port,
      destination: backend.pods,
    })
  );
}

/**
 * Configured connections that NetworkPolicy would drop, each once, as
 * `<namespace>/<workload> -> <namespace>/<service>:<port> (<side>)`. `egress`
 * means the client's Egress policies do not let it reach any backend pod;
 * `ingress` means no backend's Ingress policies admit the client.
 */
export function blockedConfiguredConnections(fleet: Fleet): string[] {
  return [
    ...new Set(
      configuredConnections(fleet).flatMap(({ client, target, backends }) => {
        const pods = podsOf(client);
        const sides = [
          backends.some((backend) => egressAllows(fleet, pods, backend))
            ? undefined
            : "egress",
          backends.some((backend) => ingressAllows(fleet, pods, backend))
            ? undefined
            : "ingress",
        ];
        return sides.flatMap((side) =>
          side === undefined ? [] : [`${client.key} -> ${target} (${side})`],
        );
      }),
    ),
  ].sort();
}
