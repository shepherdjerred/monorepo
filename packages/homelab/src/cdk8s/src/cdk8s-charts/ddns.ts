import { App, Chart } from "cdk8s";
import { createDdnsDeployment } from "../resources/ddns.ts";

export function createDdnsChart(app: App) {
  const chart = new Chart(app, "ddns", {
    namespace: "ddns",
    disableResourceNameHashes: true,
  });

  createDdnsDeployment(chart);
}
