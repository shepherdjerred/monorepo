import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  CI_CACHE_ACTIVE,
  createCiCacheDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/ci-cache/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createCiCacheChart(app: App, active = CI_CACHE_ACTIVE) {
  const chart = new Chart(app, "ci-cache", {
    namespace: "ci-cache",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "ci-cache-namespace", {
    metadata: { name: "ci-cache" },
  });
  createCiCacheDeployment(chart);
  return chart;
}
