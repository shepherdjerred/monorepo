/**
 * Live NetworkPolicies as the network-policy scripts read them. These scripts
 * read and write the live objects only; nothing here imports cdk8s source.
 */
import { z } from "zod";
import { kubectlJson, type CommandRunner } from "./command.ts";

export const NamespaceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u, "not a namespace name");

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

const EmptyRuleSchema = z.strictObject({});

/** An empty rule (`{}`) matches every peer and port. */
function allowsAll(rules: readonly unknown[] | undefined): boolean {
  return (rules ?? []).some((rule) => EmptyRuleSchema.safeParse(rule).success);
}

/**
 * Selects every pod and allows all ingress and egress. Such a policy isolates
 * nothing: NetworkPolicies add up, so every pod in its namespace is open.
 */
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
