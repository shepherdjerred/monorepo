import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/project.ts";

export function createProjectChart(app: App) {
  const chart = new Chart(app, "project", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  createProject(chart);
}
