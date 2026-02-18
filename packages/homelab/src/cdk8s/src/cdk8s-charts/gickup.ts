import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createGickupDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/gickup.ts";

export async function createGickupChart(app: App) {
  const chart = new Chart(app, "gickup", {
    namespace: "gickup",
    disableResourceNameHashes: true,
  });

  await createGickupDeployment(chart);
}
