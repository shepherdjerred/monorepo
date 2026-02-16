import { App, Chart } from "cdk8s";
import { createGickupDeployment } from "../resources/gickup.ts";

export async function createGickupChart(app: App) {
  const chart = new Chart(app, "gickup", {
    namespace: "gickup",
    disableResourceNameHashes: true,
  });

  await createGickupDeployment(chart);
}
