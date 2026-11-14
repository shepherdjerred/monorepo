/**
 * The staging NetworkPolicy, `enforcement-staging-<namespace>`: one allow-all
 * policy per namespace that has policies. While it selects every pod the
 * namespace is "open"; when it selects a label no pod carries the namespace
 * is "enforced". The namespace is part of the name because the root ArgoCD
 * release needs group/kind/name unique across namespaces.
 *
 * cdk8s renders the policy from `fleet-policy/enforcement-stages.ts` and names
 * it with `enforcementStagingPolicyName` (`cdk8s/src/misc/network-policies.ts`).
 * These scripts read and write the live object only, so the names here are
 * the contract between the two.
 */
import { z } from "zod";
import { kubectlJson, type CommandRunner } from "./command.ts";

const STAGING_POLICY_PREFIX = "enforcement-staging-";
export const NEVER_LABEL = "homelab.sjer.red/enforcement-staging";
export const NEVER_VALUE = "never";
export const STAGE_MAP_PATH =
  "packages/homelab/src/cdk8s/src/fleet-policy/enforcement-stages.ts";

export const NamespaceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u, "not a namespace name");

/** The staging policy of a namespace: `enforcement-staging-<namespace>`. */
export function stagingPolicyName(namespace: string): string {
  return `${STAGING_POLICY_PREFIX}${NamespaceNameSchema.parse(namespace)}`;
}

function isStagingPolicy(policy: NetworkPolicy): boolean {
  return (
    policy.metadata.name ===
    `${STAGING_POLICY_PREFIX}${policy.metadata.namespace}`
  );
}

const LabelSelectorSchema = z.object({
  matchLabels: z.record(z.string(), z.string()).optional(),
  matchExpressions: z.array(z.unknown()).optional(),
});

export const NetworkPolicySchema = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    podSelector: LabelSelectorSchema,
    policyTypes: z.array(z.string()).optional(),
    ingress: z.array(z.unknown()).optional(),
    egress: z.array(z.unknown()).optional(),
  }),
});
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

const NetworkPolicyListSchema = z.object({
  items: z.array(NetworkPolicySchema),
});

/**
 * - `open`: selects every pod and allows everything both ways.
 * - `enforced`: selects only the label no pod carries.
 * - `none`: the namespace has no staging policy.
 * - `unrecognized`: a staging policy that is neither, so its effect is unknown.
 */
export type Stage = "open" | "enforced" | "none" | "unrecognized";

const STAGE_LABELS: Record<Stage, string> = {
  open: "open",
  enforced: "enforced",
  none: "no staging policy",
  unrecognized: "unrecognized staging policy",
};

export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage];
}

const EmptyRuleSchema = z.strictObject({});

/** An empty rule (`{}`) matches every peer and port. */
function allowsAll(rules: readonly unknown[] | undefined): boolean {
  return (rules ?? []).some((rule) => EmptyRuleSchema.safeParse(rule).success);
}

/** Selects every pod and allows all ingress and egress. */
export function allowsEverythingForEveryPod(policy: NetworkPolicy): boolean {
  const { podSelector, policyTypes, ingress, egress } = policy.spec;
  const types = new Set(policyTypes);
  return (
    (podSelector.matchExpressions ?? []).length === 0 &&
    Object.keys(podSelector.matchLabels ?? {}).length === 0 &&
    types.has("Ingress") &&
    types.has("Egress") &&
    allowsAll(ingress) &&
    allowsAll(egress)
  );
}

export function stageOf(policy: NetworkPolicy | undefined): Stage {
  if (policy === undefined) {
    return "none";
  }
  const { podSelector } = policy.spec;
  if ((podSelector.matchExpressions ?? []).length > 0) {
    return "unrecognized";
  }
  const labels = Object.entries(podSelector.matchLabels ?? {});
  const [label, ...others] = labels;
  if (label === undefined) {
    return allowsEverythingForEveryPod(policy) ? "open" : "unrecognized";
  }
  return others.length === 0 &&
    label[0] === NEVER_LABEL &&
    label[1] === NEVER_VALUE
    ? "enforced"
    : "unrecognized";
}

export function stagingPolicyOf(
  policies: readonly NetworkPolicy[],
  namespace: string,
): NetworkPolicy | undefined {
  return policies.find(
    (policy) =>
      policy.metadata.namespace === namespace && isStagingPolicy(policy),
  );
}

/**
 * Every namespace that has its own staging policy, sorted. A policy named for
 * another namespace is not one.
 */
export function stagedNamespaces(policies: readonly NetworkPolicy[]): string[] {
  return policies
    .filter((policy) => isStagingPolicy(policy))
    .map((policy) => policy.metadata.namespace)
    .toSorted();
}

/** Every namespace that has any NetworkPolicy, sorted. */
export function namespacesWithPolicies(
  policies: readonly NetworkPolicy[],
): string[] {
  return [
    ...new Set(policies.map((policy) => policy.metadata.namespace)),
  ].toSorted();
}

export async function readNetworkPolicies(
  run: CommandRunner,
): Promise<NetworkPolicy[]> {
  const list = await kubectlJson(
    run,
    ["get", "networkpolicies.networking.k8s.io", "--all-namespaces"],
    NetworkPolicyListSchema,
  );
  return list.items;
}
