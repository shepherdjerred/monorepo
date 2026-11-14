#!/usr/bin/env bun
/**
 * The ordered restart for the enforcement switch. The enforcer never labels a
 * connection that was open before it started, so once a pod is isolated the
 * replies on such a connection are judged as new inbound connections
 * (kubernetes-sigs/kube-network-policies#418). Restarting every workload a
 * policy selects, right after the enforcer starts, reopens those connections
 * under it. This script only reads the cluster and prints the commands.
 */
import { z } from "zod";
import { isBreakGlassPolicy } from "./break-glass.ts";
import { kubectlJson, runCommand, type CommandRunner } from "./command.ts";
import {
  NamespaceNameSchema,
  readNetworkPolicies,
  stagingPolicyName,
  type NetworkPolicy,
} from "./staging-policy.ts";

const OwnerSchema = z.object({ kind: z.string(), name: z.string() });

export const RestartPodSchema = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
    ownerReferences: z.array(OwnerSchema).optional(),
  }),
  spec: z.object({ hostNetwork: z.boolean().optional() }),
  status: z.object({ phase: z.string().optional() }),
});
export type RestartPod = z.infer<typeof RestartPodSchema>;

export const ReplicaSetSchema = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    ownerReferences: z.array(OwnerSchema).optional(),
  }),
});
export type ReplicaSet = z.infer<typeof ReplicaSetSchema>;

const ExpressionSchema = z.object({
  key: z.string(),
  operator: z.enum(["In", "NotIn", "Exists", "DoesNotExist"]),
  values: z.array(z.string()).optional(),
});

/** Whether a policy's `podSelector` selects a pod with these labels. */
export function selectorMatches(
  selector: NetworkPolicy["spec"]["podSelector"],
  labels: Readonly<Record<string, string>>,
): boolean {
  const exact = Object.entries(selector.matchLabels ?? {}).every(
    ([key, value]) => labels[key] === value,
  );
  return (
    exact &&
    (selector.matchExpressions ?? []).every((raw) => {
      const { key, operator, values = [] } = ExpressionSchema.parse(raw);
      const value = labels[key];
      switch (operator) {
        case "In": {
          return value !== undefined && values.includes(value);
        }
        case "NotIn": {
          return value === undefined || !values.includes(value);
        }
        case "Exists": {
          return value !== undefined;
        }
        case "DoesNotExist": {
          return value === undefined;
        }
      }
    })
  );
}

const WorkloadKindSchema = z.enum(["Deployment", "StatefulSet", "DaemonSet"]);
type WorkloadKind = z.infer<typeof WorkloadKindSchema>;

export const TIERS = ["postgresql", "temporal", "other"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_TITLES: Record<Tier, string> = {
  postgresql: "PostgreSQL clusters",
  temporal: "Temporal",
  other: "Everything else",
};

/** Zalando postgres-operator pods carry `application: spilo`. */
const POSTGRESQL_LABEL = ["application", "spilo"] as const;
const TEMPORAL_NAMESPACE = "temporal";
/** Restarted before the workers that hold connections to it. */
const TEMPORAL_SERVER = "temporal-temporal-server";

export type Workload = {
  namespace: string;
  kind: WorkloadKind;
  name: string;
  tier: Tier;
  /** Selected pods of this workload. */
  pods: number;
};

/** A selected pod no rollout restarts: a Job's, a bare pod, a custom owner. */
export type UnmanagedPod = { namespace: string; name: string; owner: string };

export type RestartPlan = { workloads: Workload[]; unmanaged: UnmanagedPod[] };

/** A ReplicaSet's pod belongs to the Deployment that owns the ReplicaSet. */
function ownerOf(
  pod: RestartPod,
  replicaSets: readonly ReplicaSet[],
): { kind: string; name: string } | undefined {
  const owner = pod.metadata.ownerReferences?.[0];
  if (owner?.kind !== "ReplicaSet") {
    return owner;
  }
  const replicaSet = replicaSets.find(
    (candidate) =>
      candidate.metadata.namespace === pod.metadata.namespace &&
      candidate.metadata.name === owner.name,
  );
  return replicaSet?.metadata.ownerReferences?.[0] ?? owner;
}

function tierOf(pod: RestartPod): Tier {
  if (pod.metadata.labels?.[POSTGRESQL_LABEL[0]] === POSTGRESQL_LABEL[1]) {
    return "postgresql";
  }
  return pod.metadata.namespace === TEMPORAL_NAMESPACE ? "temporal" : "other";
}

function order(left: Workload, right: Workload): number {
  const rank = (workload: Workload) =>
    [
      String(TIERS.indexOf(workload.tier)),
      workload.name === TEMPORAL_SERVER ? "0" : "1",
      workload.namespace,
      workload.kind,
      workload.name,
    ].join("\u0000");
  return rank(left).localeCompare(rank(right));
}

/**
 * Every workload with a running or pending pod that a NetworkPolicy selects.
 * The staging and break-glass policies do not count: they allow everything,
 * so they never isolate a pod. Host-network pods are skipped because policies
 * do not apply to them.
 */
export function restartPlan(
  policies: readonly NetworkPolicy[],
  pods: readonly RestartPod[],
  replicaSets: readonly ReplicaSet[],
  namespaces: readonly string[] = [],
): RestartPlan {
  const isolating = policies.filter(
    (policy) =>
      policy.metadata.name !== stagingPolicyName(policy.metadata.namespace) &&
      !isBreakGlassPolicy(policy),
  );
  const workloads = new Map<string, Workload>();
  const unmanaged: UnmanagedPod[] = [];
  for (const pod of pods) {
    const { namespace, name, labels = {} } = pod.metadata;
    const live =
      pod.status.phase !== "Succeeded" && pod.status.phase !== "Failed";
    const wanted = namespaces.length === 0 || namespaces.includes(namespace);
    const selected = isolating.some(
      (policy) =>
        policy.metadata.namespace === namespace &&
        selectorMatches(policy.spec.podSelector, labels),
    );
    if (!live || !wanted || !selected || pod.spec.hostNetwork === true) {
      continue;
    }
    const owner = ownerOf(pod, replicaSets);
    const kind = WorkloadKindSchema.safeParse(owner?.kind);
    if (owner === undefined || !kind.success) {
      unmanaged.push({
        namespace,
        name,
        owner: owner === undefined ? "none" : `${owner.kind}/${owner.name}`,
      });
      continue;
    }
    const key = [namespace, owner.kind, owner.name].join("/");
    const known = workloads.get(key);
    workloads.set(key, {
      namespace,
      kind: kind.data,
      name: owner.name,
      tier: known?.tier ?? tierOf(pod),
      pods: (known?.pods ?? 0) + 1,
    });
  }
  return {
    workloads: [...workloads.values()].toSorted(order),
    unmanaged: unmanaged.toSorted((left, right) =>
      `${left.namespace}/${left.name}`.localeCompare(
        `${right.namespace}/${right.name}`,
      ),
    ),
  };
}

/** The two commands of one workload: restart it, then wait for it. */
export function restartCommands(workload: Workload): [string, string] {
  const target = `${workload.kind.toLowerCase()}/${workload.name}`;
  const kubectl = `kubectl -n ${workload.namespace} rollout`;
  return [
    `${kubectl} restart ${target}`,
    `${kubectl} status ${target} --timeout=10m`,
  ];
}

/** A shell script of comments and commands, in the order to run them. */
export function renderPlan(plan: RestartPlan): string {
  const namespaces = new Set(plan.workloads.map((entry) => entry.namespace));
  const lines = [
    `# Restart plan: ${String(plan.workloads.length)} workloads in ${String(namespaces.size)} namespaces have pods a NetworkPolicy selects.`,
    "# Nothing was run. Run the commands in this order, one workload at a time.",
  ];
  for (const [index, tier] of TIERS.entries()) {
    const members = plan.workloads.filter((entry) => entry.tier === tier);
    lines.push(
      "",
      `# ${String(index + 1)}. ${TIER_TITLES[tier]} (${String(members.length)})`,
      ...members.flatMap((workload) => restartCommands(workload)),
    );
  }
  if (plan.unmanaged.length > 0) {
    lines.push(
      "",
      `# Not restarted: ${String(plan.unmanaged.length)} selected pods no rollout owns. They keep their old connections until they end.`,
      ...plan.unmanaged.map(
        (pod) => `#   ${pod.namespace}/${pod.name} (owner: ${pod.owner})`,
      ),
    );
  }
  return lines.join("\n");
}

export type PlanOptions = { json: boolean; namespaces: string[] };

const USAGE = "Usage: restart-plan.ts [--json] [--namespace <name>]...";

export function parsePlanArguments(argv: readonly string[]): PlanOptions {
  const options: PlanOptions = { json: false, namespaces: [] };
  const rest = [...argv];
  while (rest.length > 0) {
    const argument = rest.shift();
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--namespace") {
      const parsed = NamespaceNameSchema.safeParse(rest.shift());
      if (!parsed.success) {
        throw new Error(`--namespace needs a namespace name. ${USAGE}`);
      }
      options.namespaces.push(parsed.data);
    } else {
      throw new Error(`Unknown argument ${String(argument)}. ${USAGE}`);
    }
  }
  return options;
}

function list<SCHEMA extends z.ZodType>(schema: SCHEMA) {
  return z.object({ items: z.array(schema) });
}

/** Reads policies, pods and ReplicaSets; returns what to print. */
export async function runPlan(
  options: PlanOptions,
  run: CommandRunner,
): Promise<string> {
  const [policies, pods, replicaSets] = await Promise.all([
    readNetworkPolicies(run),
    kubectlJson(
      run,
      ["get", "pods", "--all-namespaces"],
      list(RestartPodSchema),
    ),
    kubectlJson(
      run,
      ["get", "replicasets", "--all-namespaces"],
      list(ReplicaSetSchema),
    ),
  ]);
  const plan = restartPlan(
    policies,
    pods.items,
    replicaSets.items,
    options.namespaces,
  );
  return options.json ? JSON.stringify(plan, null, 2) : renderPlan(plan);
}

if (import.meta.main) {
  console.log(await runPlan(parsePlanArguments(Bun.argv.slice(2)), runCommand));
}
