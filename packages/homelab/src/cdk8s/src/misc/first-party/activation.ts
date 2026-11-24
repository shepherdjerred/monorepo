import type { Chart } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";

/**
 * Closes a prepared service's activation gate: the chart publishes only an
 * inactive marker, which keeps the Helm inventory complete while nothing
 * deploys. Returns the chart so the caller's gate is one line:
 *
 *   if (image === undefined) return closeActivationGate(chart);
 */
export function closeActivationGate(chart: Chart): Chart {
  new ConfigMap(chart, "activation", { data: { active: "false" } });
  return chart;
}
