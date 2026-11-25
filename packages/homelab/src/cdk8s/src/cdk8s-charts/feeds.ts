import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  FEEDS_ACTIVE,
  createFeedsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/feeds/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createFeedsChart(app: App, active = FEEDS_ACTIVE) {
  const chart = new Chart(app, "feeds", {
    namespace: "feeds",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "feeds-namespace", { metadata: { name: "feeds" } });
  createFeedsDeployment(chart);
  return chart;
}
