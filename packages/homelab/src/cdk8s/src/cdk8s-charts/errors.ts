import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  ERRORS_ACTIVE,
  createErrorsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/errors/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createErrorsChart(app: App, active = ERRORS_ACTIVE) {
  const chart = new Chart(app, "errors", {
    namespace: "errors",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "errors-namespace", { metadata: { name: "errors" } });
  createErrorsDeployment(chart);
  return chart;
}
