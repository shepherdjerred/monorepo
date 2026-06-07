import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createMarioKartDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/mario-kart.ts";

export function createMarioKartChart(app: App) {
  const chart = new Chart(app, "mario-kart", {
    namespace: "mario-kart",
    disableResourceNameHashes: true,
  });

  createMarioKartDeployment(chart);
}
