import { z } from "zod";
import {
  getRegisteredBackendProbes,
  type BackendProbeDescriptor,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { enforcementStagingPolicyName } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  objectIdentity,
  synthesizedCharts,
  type SynthesizedObject,
} from "@shepherdjerred/homelab/cdk8s/src/testing/synthesized-charts.ts";

/**
 * The synthesized fleet as the policy tests see it: every rendered object
 * once, the pod-bearing workloads among them, and their containers.
 *
 * Policy tests assert a rule over this whole fleet and carry a debt allowlist
 * of today's exceptions (`debt-allowlists.ts`). An allowlist may only shrink:
 * a workload that newly breaks a rule fails, and so does an entry that no
 * longer breaks it.
 */

const ProbeSchema = z.looseObject({});

const ContainerSchema = z.looseObject({
  name: z.string(),
  ports: z
    .array(
      z.looseObject({
        containerPort: z.number(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  readinessProbe: ProbeSchema.optional(),
  startupProbe: ProbeSchema.optional(),
  restartPolicy: z.string().optional(),
  securityContext: z
    .looseObject({
      allowPrivilegeEscalation: z.boolean().optional(),
      seccompProfile: z.looseObject({ type: z.string() }).optional(),
    })
    .optional(),
});
export type FleetContainerSpec = z.infer<typeof ContainerSchema>;

const PodSpecSchema = z.looseObject({
  hostNetwork: z.boolean().optional(),
  containers: z.array(ContainerSchema),
  initContainers: z.array(ContainerSchema).optional(),
  securityContext: z
    .looseObject({
      seccompProfile: z.looseObject({ type: z.string() }).optional(),
    })
    .optional(),
});

const WorkloadSpecSchema = z.object({
  spec: z.looseObject({
    template: z.looseObject({
      metadata: z
        .looseObject({ labels: z.record(z.string(), z.string()).optional() })
        .optional(),
      spec: PodSpecSchema,
    }),
  }),
});

const LabelSelectorSchema = z.looseObject({
  matchLabels: z.record(z.string(), z.string()).optional(),
  matchExpressions: z
    .array(
      z.object({
        key: z.string(),
        operator: z.enum(["In", "NotIn", "Exists", "DoesNotExist"]),
        values: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type LabelSelector = z.infer<typeof LabelSelectorSchema>;

const NetworkPolicyPeerSchema = z.looseObject({
  podSelector: LabelSelectorSchema.optional(),
  namespaceSelector: LabelSelectorSchema.optional(),
  ipBlock: z
    .looseObject({ cidr: z.string(), except: z.array(z.string()).optional() })
    .optional(),
});
export type NetworkPolicyPeer = z.infer<typeof NetworkPolicyPeerSchema>;

const NetworkPolicyPortSchema = z.looseObject({
  port: z.union([z.number(), z.string()]).optional(),
  endPort: z.number().optional(),
  protocol: z.string().optional(),
});

const NetworkPolicyPortsSchema = z.array(NetworkPolicyPortSchema).optional();

const NetworkPolicySpecSchema = z.object({
  spec: z.looseObject({
    podSelector: LabelSelectorSchema,
    policyTypes: z.array(z.enum(["Ingress", "Egress"])),
    ingress: z
      .array(
        z.looseObject({
          from: z.array(NetworkPolicyPeerSchema).optional(),
          ports: NetworkPolicyPortsSchema,
        }),
      )
      .optional(),
    egress: z
      .array(
        z.looseObject({
          to: z.array(NetworkPolicyPeerSchema).optional(),
          ports: NetworkPolicyPortsSchema,
        }),
      )
      .optional(),
  }),
});

const ServiceSpecSchema = z.object({
  spec: z.looseObject({
    selector: z.record(z.string(), z.string()).optional(),
    ports: z
      .array(
        z.looseObject({
          port: z.number(),
          targetPort: z.union([z.number(), z.string()]).optional(),
        }),
      )
      .optional(),
  }),
});

const ApplicationSpecSchema = z.object({
  spec: z.looseObject({
    destination: z.looseObject({ namespace: z.string() }),
  }),
});

/** Kinds whose pods run until stopped. Jobs run to completion. */
const LONG_RUNNING_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
const WORKLOAD_KINDS = new Set([...LONG_RUNNING_KINDS, "Job"]);

export type FleetWorkload = {
  /** `<namespace>/<name>`, the allowlist key. */
  key: string;
  kind: string;
  namespace: string;
  name: string;
  longRunning: boolean;
  hostNetwork: boolean;
  podLabels: Readonly<Record<string, string>>;
  podSeccomp: string | undefined;
  containers: readonly FleetContainer[];
};

export type FleetContainer = {
  /** `<namespace>/<workload>/<container>`, the allowlist key. */
  key: string;
  /** A plain init container runs to completion before the pod serves. */
  runsToCompletion: boolean;
  spec: FleetContainerSpec;
};

export type PolicyType = "Ingress" | "Egress";

/** One `ports` entry of a NetworkPolicy rule; the protocol defaults to TCP. */
export type FleetPolicyPort = {
  protocol: string;
  /** A number, or a container port name. Absent means every port. */
  port: number | string | undefined;
  endPort: number | undefined;
};

/** One ingress or egress rule, whichever side its policy type names. */
export type FleetPolicyRule = {
  /** The `from` or `to` peers. Absent means every peer. */
  peers: readonly NetworkPolicyPeer[] | undefined;
  /** Absent means every port. */
  ports: readonly FleetPolicyPort[] | undefined;
};

export type FleetNetworkPolicy = {
  namespace: string;
  name: string;
  podSelector: LabelSelector;
  policyTypes: readonly PolicyType[];
  ingress: readonly FleetPolicyRule[];
  egress: readonly FleetPolicyRule[];
};

export type FleetService = {
  namespace: string;
  name: string;
  /** Absent on a Service whose endpoints are managed elsewhere. */
  selector: Readonly<Record<string, string>> | undefined;
  ports: readonly { port: number; targetPort: number | string | undefined }[];
};

export type Fleet = {
  objects: readonly SynthesizedObject[];
  workloads: readonly FleetWorkload[];
  /**
   * The policies that decide traffic once a namespace is enforced. The
   * enforcement staging policies are kept apart so that no rule can count
   * an allow-all staging policy as coverage or admission.
   */
  networkPolicies: readonly FleetNetworkPolicy[];
  /** The enforcement staging policy of each staged namespace. */
  enforcementStagingPolicies: readonly FleetNetworkPolicy[];
  services: readonly FleetService[];
  /** Service selectors by namespace. */
  serviceSelectors: readonly {
    namespace: string;
    selector: Readonly<Record<string, string>>;
  }[];
  /** Destination namespace of every Argo Application. */
  applicationNamespaces: ReadonlySet<string>;
  /** Every in-cluster blackbox probe the charts registered while rendering. */
  backendProbes: readonly BackendProbeDescriptor[];
};

function namespaceOf(object: SynthesizedObject): string {
  const { namespace } = object.metadata;
  if (namespace === undefined)
    throw new Error(`${objectIdentity(object)} has no namespace`);
  return namespace;
}

function toWorkload(object: SynthesizedObject): FleetWorkload {
  const namespace = namespaceOf(object);
  const { template } = WorkloadSpecSchema.parse(object).spec;
  const key = `${namespace}/${object.metadata.name}`;
  const longRunning = LONG_RUNNING_KINDS.has(object.kind);
  const toContainer = (spec: FleetContainerSpec, init: boolean) => ({
    key: `${key}/${spec.name}`,
    // A native sidecar is an init container that keeps running.
    runsToCompletion: !longRunning || (init && spec.restartPolicy !== "Always"),
    spec,
  });
  return {
    key,
    kind: object.kind,
    namespace,
    name: object.metadata.name,
    longRunning,
    hostNetwork: template.spec.hostNetwork === true,
    podLabels: template.metadata?.labels ?? {},
    podSeccomp: template.spec.securityContext?.seccompProfile?.type,
    containers: [
      ...template.spec.containers.map((spec) => toContainer(spec, false)),
      ...(template.spec.initContainers ?? []).map((spec) =>
        toContainer(spec, true),
      ),
    ],
  };
}

/** Kubernetes treats an absent and an empty peer or port list alike: no limit. */
function toPolicyRule(
  peers: readonly NetworkPolicyPeer[] | undefined,
  ports: z.infer<typeof NetworkPolicyPortsSchema>,
): FleetPolicyRule {
  return {
    peers: peers === undefined || peers.length === 0 ? undefined : peers,
    ports:
      ports === undefined || ports.length === 0
        ? undefined
        : ports.map(({ protocol = "TCP", port, endPort }) => ({
            protocol,
            port,
            endPort,
          })),
  };
}

function toNetworkPolicy(object: SynthesizedObject): FleetNetworkPolicy {
  const { podSelector, policyTypes, ingress, egress } =
    NetworkPolicySpecSchema.parse(object).spec;
  return {
    namespace: namespaceOf(object),
    name: object.metadata.name,
    podSelector,
    policyTypes,
    ingress: (ingress ?? []).map((rule) => toPolicyRule(rule.from, rule.ports)),
    egress: (egress ?? []).map((rule) => toPolicyRule(rule.to, rule.ports)),
  };
}

function toService(object: SynthesizedObject): FleetService {
  const { selector, ports } = ServiceSpecSchema.parse(object).spec;
  return {
    namespace: namespaceOf(object),
    name: object.metadata.name,
    selector,
    ports: (ports ?? []).map(({ port, targetPort }) => ({ port, targetPort })),
  };
}

/** Kubernetes label-selector semantics; an empty selector matches every pod. */
export function selectorMatches(
  selector: LabelSelector,
  labels: Readonly<Record<string, string>>,
): boolean {
  const labelsMatch = Object.entries(selector.matchLabels ?? {}).every(
    ([key, value]) => labels[key] === value,
  );
  const expressionsMatch = (selector.matchExpressions ?? []).every(
    ({ key, operator, values = [] }) => {
      const value = labels[key];
      if (operator === "Exists") return value !== undefined;
      if (operator === "DoesNotExist") return value === undefined;
      const listed = value !== undefined && values.includes(value);
      return operator === "In" ? listed : !listed;
    },
  );
  return labelsMatch && expressionsMatch;
}

/**
 * Split a rule's current violations against its debt allowlist. Both lists
 * must be empty: `unexpected` is a new violation, `stale` is an allowlist
 * entry that no longer violates and must be deleted.
 */
export function againstDebt(
  violations: Iterable<string>,
  allowlist: ReadonlySet<string>,
): { unexpected: string[]; stale: string[] } {
  const current = new Set(violations);
  return {
    unexpected: [...current].filter((key) => !allowlist.has(key)).sort(),
    stale: [...allowlist].filter((key) => !current.has(key)).sort(),
  };
}

function isStaging(policy: FleetNetworkPolicy): boolean {
  return policy.name === enforcementStagingPolicyName(policy.namespace);
}

/** The fleet the given rendered objects and registered probes make up. */
export function fleetOf(
  objects: readonly SynthesizedObject[],
  backendProbes: readonly BackendProbeDescriptor[],
): Fleet {
  const policies = objects
    .filter(
      (object) =>
        object.kind === "NetworkPolicy" &&
        object.apiVersion === "networking.k8s.io/v1",
    )
    .map((object) => toNetworkPolicy(object));
  const services = objects
    .filter((object) => object.kind === "Service")
    .map((object) => toService(object));

  return {
    objects,
    workloads: objects
      .filter((object) => WORKLOAD_KINDS.has(object.kind))
      .map((object) => toWorkload(object)),
    networkPolicies: policies.filter((policy) => !isStaging(policy)),
    enforcementStagingPolicies: policies.filter((policy) => isStaging(policy)),
    services,
    serviceSelectors: services.flatMap(({ namespace, selector }) =>
      selector === undefined ? [] : [{ namespace, selector }],
    ),
    applicationNamespaces: new Set(
      objects
        .filter((object) => object.kind === "Application")
        .map(
          (object) =>
            ApplicationSpecSchema.parse(object).spec.destination.namespace,
        ),
    ),
    backendProbes,
  };
}

export async function loadFleet(): Promise<Fleet> {
  // A companion chart can render the same object as its owner chart; the API
  // server holds one, so the fleet does too.
  const byIdentity = new Map<string, SynthesizedObject>();
  const charts = await synthesizedCharts();
  for (const objects of charts.values())
    for (const object of objects)
      byIdentity.set(objectIdentity(object), object);
  // The registry is filled while the charts above are constructed.
  return fleetOf([...byIdentity.values()], getRegisteredBackendProbes());
}
