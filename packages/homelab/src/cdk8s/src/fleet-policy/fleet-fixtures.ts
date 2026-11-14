import type {
  Fleet,
  FleetNetworkPolicy,
  FleetWorkload,
  NetworkPolicyPeer,
} from "./fleet.ts";

/** Hand-built fleets for the unit tests of the fleet rules. */

const NAMESPACE_NAME = "kubernetes.io/metadata.name";

export function namespacePeer(name: string): NetworkPolicyPeer {
  return { namespaceSelector: { matchLabels: { [NAMESPACE_NAME]: name } } };
}

export function tcpPort(port: number) {
  return { protocol: "TCP", port, endPort: undefined };
}

/** A Deployment labelled `app: <name>` with one container and one port. */
export function workload(
  namespace: string,
  name: string,
  containerPort: number,
  env: Readonly<Record<string, string>> = {},
): FleetWorkload {
  return {
    key: `${namespace}/${name}`,
    kind: "Deployment",
    namespace,
    name,
    longRunning: true,
    hostNetwork: false,
    podLabels: { app: name },
    podSeccomp: undefined,
    containers: [
      {
        key: `${namespace}/${name}/main`,
        runsToCompletion: false,
        spec: {
          name: "main",
          ports: [{ containerPort }],
          env: Object.entries(env).map(([key, value]) => ({
            name: key,
            value,
          })),
        },
      },
    ],
  };
}

/** A policy on the pods labelled `app: <app>`, or on the whole namespace. */
export function policy(
  namespace: string,
  app: string | undefined,
  rules:
    Pick<FleetNetworkPolicy, "ingress"> | Pick<FleetNetworkPolicy, "egress">,
): FleetNetworkPolicy {
  const ingress = "ingress" in rules;
  return {
    namespace,
    name: `${app ?? namespace}-${ingress ? "ingress" : "egress"}`,
    podSelector: app === undefined ? {} : { matchLabels: { app } },
    policyTypes: [ingress ? "Ingress" : "Egress"],
    ingress: [],
    egress: [],
    ...rules,
  };
}

export function fleetOf(
  parts: Partial<
    Pick<Fleet, "objects" | "workloads" | "networkPolicies" | "services">
  >,
): Fleet {
  return {
    objects: [],
    workloads: [],
    networkPolicies: [],
    services: [],
    serviceSelectors: [],
    applicationNamespaces: new Set(),
    backendProbes: [],
    ...parts,
  };
}
