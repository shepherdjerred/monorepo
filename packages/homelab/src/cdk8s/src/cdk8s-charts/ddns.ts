import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createDdnsDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/ddns.ts";

export function createDdnsChart(app: App) {
  const chart = new Chart(app, "ddns", {
    namespace: "ddns",
    disableResourceNameHashes: true,
  });

  createDdnsDeployment(chart);
}
