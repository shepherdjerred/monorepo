import { ApiObject, App, Chart, JsonPatch, Names } from "cdk8s";
import { Pod } from "cdk8s-plus-31";
import { Construct } from "constructs";
import { ROOT_CHART } from "./charts.ts";

function escapePointer(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childEntries(value: unknown): [key: string, child: unknown][] {
  return Array.isArray(value)
    ? value.map((child: unknown, index): [string, unknown] => [
        String(index),
        child,
      ])
    : value !== null && typeof value === "object"
      ? Object.entries(value)
      : [];
}

function addressLabels(
  value: unknown,
  path: readonly string[],
): [pointer: string, address: string][] {
  return childEntries(value).flatMap(([key, child]) =>
    typeof child === "string" && key === Pod.ADDRESS_LABEL
      ? [[`/${[...path, escapePointer(key)].join("/")}`, child]]
      : addressLabels(child, [...path, escapePointer(key)]),
  );
}

/**
 * cdk8s-plus derives each workload's `cdk8s.io/metadata.addr` selector from
 * the construct path, which starts with the chart id. A baseline chart
 * re-renders the root's constructs under its own id, so it adopts the values
 * the same constructs produce under the root chart: the selector is immutable
 * on the running workloads and must stay identical across the cutover.
 */
export function adoptRootChartAddresses(chart: Chart): void {
  const rootMirror = new Chart(new App(), ROOT_CHART);
  const addresses = new Map<string, string>();
  for (const construct of chart.node.findAll()) {
    if (construct === chart) continue;
    let mirror: Construct = rootMirror;
    for (const id of construct.node.path
      .slice(chart.node.path.length + 1)
      .split("/"))
      mirror = mirror.node.tryFindChild(id) ?? new Construct(mirror, id);
    addresses.set(Names.toLabelValue(construct), Names.toLabelValue(mirror));
  }
  for (const construct of chart.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    for (const [pointer, address] of addressLabels(construct.toJson(), [])) {
      const rootAddress = addresses.get(address);
      if (rootAddress === undefined)
        throw new Error(
          `${construct.node.path} carries workload address ${address} from outside ${chart.node.id}`,
        );
      construct.addJsonPatch(JsonPatch.replace(pointer, rootAddress));
    }
  }
}
