import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { controlPlaneJobInput } from "./control-plane.ts";
import { tofuJobInputFor, tofuJobRequestInput } from "./tofu-input.ts";

/** Stable immutable input also reconstructs the exact expected native Job during recovery. */
export function platformExecutionJob(
  detail: DeploymentDetail,
): DeliveryJobRequest {
  const pipeline = detail.pipeline.definition;
  const id = detail.deployment.id;
  if (pipeline.kind === "control-plane") {
    const input = controlPlaneJobInput(detail);
    return {
      deploymentId: id,
      stageKey: "control-plane",
      recipe: "control-plane",
      runnerImage: pipeline.runnerImage,
      sourceRevision: input.snapshot.source.sourceRevision,
      input,
    };
  }
  const snapshot = detail.deployment.platformSnapshot;
  if (
    snapshot === null ||
    snapshot.kind === "root-release" ||
    pipeline.kind !== "tofu" ||
    !("runnerImage" in pipeline)
  )
    throw new Error("Platform Job has no frozen v1 source/recipe");
  return {
    deploymentId: id,
    stageKey: snapshot.kind,
    recipe: snapshot.kind,
    runnerImage: pipeline.runnerImage,
    sourceRevision: snapshot.source.sourceRevision,
    input: tofuJobRequestInput(tofuJobInputFor(detail, snapshot)),
  };
}
