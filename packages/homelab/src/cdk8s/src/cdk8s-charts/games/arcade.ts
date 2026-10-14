import { Chart, type App } from "cdk8s";
import { createArcadeDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade.ts";

export function createArcadeChart(app: App) {
  const chart = new Chart(app, "arcade", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeDeployment(chart);
}
