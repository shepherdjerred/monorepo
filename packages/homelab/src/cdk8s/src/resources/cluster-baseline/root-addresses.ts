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
 * the construct path, which starts with the chart id. A chart that re-renders
 * another chart's constructs under a new chart id adopts the values the same
 * constructs produce under `sourceChartId`: the selector is immutable on the
 * running workloads and must stay identical across the cutover.
 */
export function adoptChartAddresses(chart: Chart, sourceChartId: string): void {
  const sourceMirror = new Chart(new App(), sourceChartId);
  const addresses = new Map<string, string>();
  for (const construct of chart.node.findAll()) {
    if (construct === chart) continue;
    let mirror: Construct = sourceMirror;
    for (const id of construct.node.path
      .slice(chart.node.path.length + 1)
      .split("/"))
      mirror = mirror.node.tryFindChild(id) ?? new Construct(mirror, id);
    addresses.set(Names.toLabelValue(construct), Names.toLabelValue(mirror));
  }
  for (const construct of chart.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    for (const [pointer, address] of addressLabels(construct.toJson(), [])) {
      const sourceAddress = addresses.get(address);
      if (sourceAddress === undefined)
        throw new Error(
          `${construct.node.path} carries workload address ${address} from outside ${chart.node.id}`,
        );
      construct.addJsonPatch(JsonPatch.replace(pointer, sourceAddress));
    }
  }
}

export function adoptRootChartAddresses(chart: Chart): void {
  adoptChartAddresses(chart, ROOT_CHART);
}

/**
 * An object whose name cdk8s generated from its construct path carries the
 * chart id, so the same construct renders `apps-argocd-ingress` under the root
 * and `argocd-companion-argocd-ingress` under a companion. A chart that takes
 * over objects from `sourceChartId` adopts its generated names; explicit names
 * stay.
 */
export function adoptChartNames(chart: Chart, sourceChartId: string): void {
  const sourceMirror = new Chart(new App(), sourceChartId);
  for (const construct of chart.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    if (construct.name !== chart.generateObjectName(construct)) continue;
    let mirror: Construct = sourceMirror;
    for (const id of construct.node.path
      .slice(chart.node.path.length + 1)
      .split("/"))
      mirror = mirror.node.tryFindChild(id) ?? new Construct(mirror, id);
    construct.addJsonPatch(
      JsonPatch.replace(
        "/metadata/name",
        Names.toDnsLabel(mirror, { includeHash: false }),
      ),
    );
  }
}

export function adoptRootChartNames(chart: Chart): void {
  adoptChartNames(chart, ROOT_CHART);
}
