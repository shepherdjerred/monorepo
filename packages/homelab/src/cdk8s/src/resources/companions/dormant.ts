import { transitionRendering } from "homelab/src/cdk8s/src/release-configuration.ts";
import { COMPANION_CHARTS } from "homelab/src/cdk8s/src/resources/companions/names.ts";

/**
 * Charts with a committed Helm shell that synthesis renders only under
 * transition rendering. With the switch off their shells have no manifest
 * and every chart tool skips them; with it on the set is empty, so each
 * shell must have its manifest like any other chart.
 */
export function dormantCharts(
  transition: boolean = transitionRendering(),
): ReadonlySet<string> {
  return transition ? new Set<string>() : COMPANION_CHARTS;
}
