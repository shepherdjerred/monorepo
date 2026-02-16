import { App, Chart } from "cdk8s";
import { createVeleroBackupLabelPolicy } from "../resources/kyverno-policies.ts";

export function createKyvernoPoliciesChart(app: App) {
  const chart = new Chart(app, "kyverno-policies", {
    disableResourceNameHashes: true,
  });

  createVeleroBackupLabelPolicy(chart);

  return chart;
}
