import { z } from "zod";
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
  ports: z.array(z.looseObject({ containerPort: z.number() })).optional(),
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

const NetworkPolicySpecSchema = z.object({
  spec: z.looseObject({
    podSelector: LabelSelectorSchema,
    policyTypes: z.array(z.enum(["Ingress", "Egress"])),
  }),
});

const ServiceSpecSchema = z.object({
  spec: z.looseObject({
    selector: z.record(z.string(), z.string()).optional(),
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

export type FleetNetworkPolicy = {
  namespace: string;
  name: string;
  podSelector: LabelSelector;
  policyTypes: readonly ("Ingress" | "Egress")[];
};

export type Fleet = {
  objects: readonly SynthesizedObject[];
  workloads: readonly FleetWorkload[];
  networkPolicies: readonly FleetNetworkPolicy[];
  /** Service selectors by namespace. */
  serviceSelectors: readonly {
    namespace: string;
    selector: Readonly<Record<string, string>>;
  }[];
  /** Destination namespace of every Argo Application. */
  applicationNamespaces: ReadonlySet<string>;
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

export async function loadFleet(): Promise<Fleet> {
  // A companion chart can render the same object as its owner chart; the API
  // server holds one, so the fleet does too.
  const byIdentity = new Map<string, SynthesizedObject>();
  const charts = await synthesizedCharts();
  for (const objects of charts.values())
    for (const object of objects)
      byIdentity.set(objectIdentity(object), object);
  const objects = [...byIdentity.values()];

  return {
    objects,
    workloads: objects
      .filter((object) => WORKLOAD_KINDS.has(object.kind))
      .map((object) => toWorkload(object)),
    networkPolicies: objects
      .filter(
        (object) =>
          object.kind === "NetworkPolicy" &&
          object.apiVersion === "networking.k8s.io/v1",
      )
      .map((object) => ({
        namespace: namespaceOf(object),
        name: object.metadata.name,
        ...NetworkPolicySpecSchema.parse(object).spec,
      })),
    serviceSelectors: objects
      .filter((object) => object.kind === "Service")
      .flatMap((object) => {
        const { selector } = ServiceSpecSchema.parse(object).spec;
        return selector === undefined
          ? []
          : [{ namespace: namespaceOf(object), selector }];
      }),
    applicationNamespaces: new Set(
      objects
        .filter((object) => object.kind === "Application")
        .map(
          (object) =>
            ApplicationSpecSchema.parse(object).spec.destination.namespace,
        ),
    ),
  };
}
