import { Chart, type App } from "cdk8s";
import { createArcadeDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade.ts";
import { createArcadeEdge } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade-edge.ts";

export function createArcadeChart(app: App) {
  const chart = new Chart(app, "arcade", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  // Suspended to free torvalds CPU until drained Temporal worker hosts can be
  // retired (AI-415); restore by removing the option.
  createArcadeDeployment(chart, { suspended: true });
  createArcadeEdge(chart);
}
