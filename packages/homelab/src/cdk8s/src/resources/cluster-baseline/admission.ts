import type { Chart } from "cdk8s";
import { createArgoCdApplicationAdmissionPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/argocd-application-admission.ts";
import { createPvcBackupAdmissionPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/pvc-backup-admission.ts";
import { createWoodpeckerCiPodGuard } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/ci-pod-guard.ts";

/** Cluster-wide admission policies and bindings, in the root chart's order. */
export function createClusterAdmission(chart: Chart): void {
  createArgoCdApplicationAdmissionPolicies(chart);
  createPvcBackupAdmissionPolicies(chart);
  createWoodpeckerCiPodGuard(chart);
}
