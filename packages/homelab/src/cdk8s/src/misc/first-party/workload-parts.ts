import { Chart } from "cdk8s";
import type { ContainerProps, ContainerResources } from "cdk8s-plus-31";
import type { Construct } from "constructs";
import {
  KubeNetworkPolicy,
  type NetworkPolicyEgressRule,
  type NetworkPolicyIngressRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * A container whose resources are stated; BestEffort is never the default.
 * `Owned` names the props the construct supplies itself.
 */
export type FirstPartyContainerSpec<
  Owned extends keyof ContainerProps = never,
> = Omit<ContainerProps, Owned | "resources"> & {
  resources: ContainerResources;
};

/**
 * A NetworkPolicy of the workload's namespace. `name` is both the construct id
 * and the resource name. The policy types are the directions it gives rules
 * for.
 */
export type FirstPartyNetworkPolicy = {
  name: string;
  /** `app` selects the workload's pods; `namespace` selects every pod. */
  selects: "app" | "namespace";
  ingress?: NetworkPolicyIngressRule[];
  egress?: NetworkPolicyEgressRule[];
};

/** The chart a first-party construct renders into, and its namespace. */
export function namespacedChart(
  scope: Construct,
  owner: string,
): { chart: Chart; namespace: string } {
  const chart = Chart.of(scope);
  if (chart.namespace === undefined)
    throw new Error(`${owner} needs a namespaced chart`);
  return { chart, namespace: chart.namespace };
}

/**
 * Renders the policies in order. `appLabels` are the pod labels an `app`
 * policy selects; a workload without them can only have `namespace` policies.
 */
export function createFirstPartyNetworkPolicies(
  scope: Construct,
  policies: FirstPartyNetworkPolicy[],
  appLabels: Record<string, string> | undefined,
): KubeNetworkPolicy[] {
  return policies.map((policy) => {
    if (appLabels === undefined && policy.selects === "app")
      throw new Error(
        `NetworkPolicy ${policy.name} selects the app, which has no pod labels`,
      );
    return new KubeNetworkPolicy(scope, policy.name, {
      metadata: { name: policy.name },
      spec: {
        podSelector:
          policy.selects === "app" ? { matchLabels: { ...appLabels } } : {},
        policyTypes: [
          ...(policy.ingress === undefined ? [] : ["Ingress"]),
          ...(policy.egress === undefined ? [] : ["Egress"]),
        ],
        ingress: policy.ingress,
        egress: policy.egress,
      },
    });
  });
}
