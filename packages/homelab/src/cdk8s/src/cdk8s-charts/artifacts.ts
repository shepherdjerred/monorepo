import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  ARTIFACTS_ACTIVE,
  createArtifactsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/artifacts/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createArtifactsChart(app: App, active = ARTIFACTS_ACTIVE) {
  const chart = new Chart(app, "artifacts", {
    namespace: "artifacts",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "artifacts-namespace", {
    metadata: { name: "artifacts" },
  });
  createArtifactsDeployment(chart);
  return chart;
}
