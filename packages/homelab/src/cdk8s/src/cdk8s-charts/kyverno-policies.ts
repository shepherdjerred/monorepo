import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createVeleroBackupLabelPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/kyverno-policies.ts";

export function createKyvernoPoliciesChart(app: App) {
  const chart = new Chart(app, "kyverno-policies", {
    disableResourceNameHashes: true,
  });

  createVeleroBackupLabelPolicy(chart);

  return chart;
}
