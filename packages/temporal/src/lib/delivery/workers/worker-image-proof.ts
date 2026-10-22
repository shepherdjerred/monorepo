import {
  WorkerRolloutSnapshotSchema,
  type WorkerRolloutSnapshot,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import { deliverySelection } from "#lib/delivery/selection.ts";
import { WorkerChartProofSchema } from "./worker-control-plane.ts";
import { modelWorkerChartSelection } from "#lib/delivery/model/worker-selection.ts";
export const WorkerImageProofInputSchema = z.strictObject({
  detail: WorkerRolloutSnapshotSchema,
  controlPlane: WorkerChartProofSchema.nullable(),
});
export function workerImageProofInput(detail: DeploymentDetail) {
  if (detail.deployment.workerSnapshot?.target !== "central")
    return WorkerImageProofInputSchema.parse({ detail, controlPlane: null });
  if (detail.pipeline.definition.kind !== "argocd")
    return WorkerImageProofInputSchema.parse({
      detail,
      controlPlane: modelWorkerChartSelection(detail),
    });
  const selected = deliverySelection(detail);
  return WorkerImageProofInputSchema.parse({
    detail,
    controlPlane: { selection: selected.selection, chart: selected.chart },
  });
}
import {
  verifyCandidateImageBuildId,
  type RolloutCommandRunner,
} from "#lib/worker-deployment-proofs.ts";

/** Verify baked provenance for every retained image before creating or replacing any host. */
export async function verifyDeliveryWorkerImages(
  detail: Pick<WorkerRolloutSnapshot, "deployment">,
  run: RolloutCommandRunner,
): Promise<void> {
  const pool = detail.deployment.workerSnapshot;
  if (pool === null)
    throw new Error("Worker image inspection requires a frozen pool");
  for (const worker of pool.versions.filter((entry) => entry.replicas === 1))
    await verifyCandidateImageBuildId(worker.image, worker.buildId, run);
}
