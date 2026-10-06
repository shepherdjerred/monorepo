import { ApiObject, type Chart } from "cdk8s";
import { minecraftMaintenanceMatch } from "./minecraft-maintenance-match.ts";

/**
 * A stopped server must remain stopped while Temporal replaces the disposable
 * mining world on its PVC. mc-router patches the StatefulSet on a connection;
 * this admission policy makes that patch fail while the maintenance lock is
 * present, even if the router has not observed the Service opt-out yet.
 */
export const MINING_RESET_LOCK_ANNOTATION = "sjer.red/mining-reset-lock";
export const MINING_RESET_IMAGE_ANNOTATION = "sjer.red/mining-reset-image";

export function createMinecraftMiningResetGuard(chart: Chart): void {
  const policyName = "minecraft-tsmc-mining-reset-lock.sjer.red";
  new ApiObject(chart, "minecraft-tsmc-mining-reset-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: policyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      ...minecraftMaintenanceMatch("statefulsets"),
      validations: [
        {
          expression: `!has(object.metadata.annotations) || !('${MINING_RESET_LOCK_ANNOTATION}' in object.metadata.annotations) || object.spec.replicas == 0`,
          message:
            "The Storm mining-world reset owns the maintenance lock; StatefulSet replicas must stay at zero",
          reason: "Forbidden",
        },
      ],
    },
  });

  new ApiObject(chart, "minecraft-tsmc-mining-reset-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: policyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: { policyName, validationActions: ["Deny"] },
  });
}
