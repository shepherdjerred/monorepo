import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  BRIM_SERVICE_ACTIVE,
  createBrimServiceDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/brim-service/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createBrimServiceChart(app: App, active = BRIM_SERVICE_ACTIVE) {
  const chart = new Chart(app, "brim-service", {
    namespace: "brim-service",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "brim-service-namespace", {
    metadata: { name: "brim-service" },
  });
  createBrimServiceDeployment(chart);
  return chart;
}
