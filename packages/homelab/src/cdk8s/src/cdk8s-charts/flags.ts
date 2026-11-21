import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { ConfigMap, Namespace } from "cdk8s-plus-31";
import {
  FLAGS_ACTIVE,
  createFlagsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/flags/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createFlagsChart(app: App, active = FLAGS_ACTIVE) {
  const chart = new Chart(app, "flags", {
    namespace: "flags",
    disableResourceNameHashes: true,
  });
  if (!active) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  new Namespace(chart, "flags-namespace", { metadata: { name: "flags" } });
  createFlagsDeployment(chart);
  return chart;
}
