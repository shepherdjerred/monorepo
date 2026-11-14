import { ApiObject, type App, type Chart } from "cdk8s";
import { enforcementStageOf } from "./fleet-policy/enforcement-stages.ts";
import {
  enforcementStagingPolicy,
  enforcementStagingPolicyName,
} from "./misc/network-policies.ts";
import { COMPANION_CHARTS } from "./resources/companions/names.ts";

/**
 * Namespaces more than one Application renders policies into, and the chart
 * that carries the namespace's one staging policy. Two Applications rendering
 * the same object would contend for it.
 */
const SHARED_NAMESPACE_OWNERS: Readonly<Record<string, string>> = {
  // temporal-data and delivery-control-plane also render policies here.
  temporal: "temporal",
};

function policyNamespacesOf(chart: Chart): Set<string> {
  const namespaces = new Set<string>();
  for (const construct of chart.node.findAll()) {
    if (
      !ApiObject.isApiObject(construct) ||
      construct.kind !== "NetworkPolicy" ||
      construct.apiVersion !== "networking.k8s.io/v1"
    )
      continue;
    const { name, namespace } = construct.metadata;
    if (namespace === undefined)
      throw new Error(`${construct.node.path} has no namespace`);
    if (name === enforcementStagingPolicyName(namespace))
      throw new Error(
        `${construct.node.path} is named ${name}, which only applyEnforcementStaging renders`,
      );
    namespaces.add(namespace);
  }
  return namespaces;
}

/**
 * The chart that owns a namespace's staging policy among the charts that
 * render policies into it. A companion chart is not an owner: it re-renders
 * root objects, so it mirrors the root's staging policy instead.
 */
function stagingOwner(namespace: string, charts: readonly Chart[]): Chart {
  const declared = SHARED_NAMESPACE_OWNERS[namespace];
  const [only, ...others] = charts;
  if (only === undefined)
    throw new Error(
      `Only companion charts render policies into ${namespace}; a companion mirrors the root`,
    );
  if (others.length === 0) {
    if (declared !== undefined)
      throw new Error(
        `SHARED_NAMESPACE_OWNERS names ${declared} for ${namespace}, which only ${only.node.id} renders policies into: delete the entry`,
      );
    return only;
  }
  const owner = charts.find((chart) => chart.node.id === declared);
  if (owner === undefined)
    throw new Error(
      `Charts ${charts.map((chart) => chart.node.id).join(", ")} all render policies into ${namespace}: name one of them in SHARED_NAMESPACE_OWNERS to carry its staging policy`,
    );
  return owner;
}

/**
 * Give every namespace the charts render a NetworkPolicy into its one
 * `enforcement-staging-<namespace>` policy, at the stage `ENFORCEMENT_STAGES` records.
 *
 * Runs over the finished app rather than in each chart so that a namespace
 * cannot gain a policy without being staged, and so that charts sharing a
 * namespace render one staging policy between them. A namespace with no
 * stage entry fails synthesis.
 */
export function applyEnforcementStaging(app: App): void {
  const renderers = new Map<string, Chart[]>();
  for (const chart of app.charts)
    for (const namespace of policyNamespacesOf(chart))
      renderers.set(namespace, [...(renderers.get(namespace) ?? []), chart]);

  for (const [namespace, charts] of renderers) {
    const stage = enforcementStageOf(namespace);
    const owner = stagingOwner(
      namespace,
      charts.filter((chart) => !COMPANION_CHARTS.has(chart.node.id)),
    );
    const companions = charts.filter((chart) =>
      COMPANION_CHARTS.has(chart.node.id),
    );
    for (const chart of [owner, ...companions])
      enforcementStagingPolicy(chart, namespace, stage);
  }
}
