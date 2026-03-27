import type { Chart } from "cdk8s";
import { KubePriorityClass } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export const INFRASTRUCTURE_PRIORITY = "infrastructure-critical";
export const SERVICE_PRIORITY = "service-standard";
export const BATCH_PRIORITY = "batch-low";

export function createPriorityClasses(chart: Chart) {
  new KubePriorityClass(chart, "infrastructure-critical", {
    metadata: { name: INFRASTRUCTURE_PRIORITY },
    value: 1_000_000,
    globalDefault: false,
    preemptionPolicy: "PreemptLowerPriority",
    description: "Critical infrastructure: monitoring, logging, storage CSI, ArgoCD",
  });

  new KubePriorityClass(chart, "service-standard", {
    metadata: { name: SERVICE_PRIORITY },
    value: 100_000,
    globalDefault: true,
    preemptionPolicy: "Never",
    description: "Standard services: homeassistant, plex, postal, etc.",
  });

  new KubePriorityClass(chart, "batch-low", {
    metadata: { name: BATCH_PRIORITY },
    value: 1000,
    globalDefault: false,
    preemptionPolicy: "Never",
    description: "Batch/ephemeral workloads: CI builds",
  });
}
