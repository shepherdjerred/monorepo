import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { DeliveryRecoverySelectionSchema } from "homelab/scripts/argocd/argocd-delivery-recovery.ts";
import { deliverySelection } from "./selection.ts";

/** Export only the frozen release of a terminal deployment that still owns its target. */
export function deliveryRecoverySelection(raw: unknown) {
  const detail = DeploymentDetailSchema.parse(raw);
  const row = detail.deployment;
  if (
    !["failed", "canceled"].includes(row.status) ||
    !row.recoveryRequired ||
    detail.environment.activeDeploymentId !== row.id ||
    detail.environment.desiredVersionSetRevisionId !== row.versionSetRevisionId
  )
    throw new Error(
      "Recovery export requires a failed or canceled deployment holding its original environment lock",
    );
  const pipeline = detail.pipeline.definition;
  if (
    pipeline.kind !== "argocd" ||
    pipeline.workerRollout !== undefined ||
    pipeline.forumRelease !== undefined
  )
    throw new Error("This target requires its specialized recovery procedure");
  const { selection, chart, operationId } = deliverySelection(detail);
  if (
    detail.stages.find((stage) => stage.key === "reconcile")?.operationId !==
    operationId
  )
    throw new Error(
      "Recovery request does not match the deployment's recorded reconciliation stage",
    );
  return DeliveryRecoverySelectionSchema.parse({
    deploymentId: row.id,
    requestId: operationId,
    selection,
    chart: { uri: chart.uri, digest: chart.digest },
  });
}
