import { z } from "zod";
import {
  PipelineRevisionSchema,
  WorkerPoolSnapshotSchema,
  type CreateDeployment,
  type Environment,
} from "#shared/contract.ts";
import { required, wire } from "./delivery-records.ts";
import type { Transaction } from "./delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";

/** Rollback restores a proven complete release, including its frozen settings. */
export async function deploymentSelection(
  tx: Transaction,
  input: CreateDeployment,
  env: Environment,
) {
  if (input.kind === "rollback" && env.serviceId === "storm-forum")
    throw new DeliveryError(
      "INVALID",
      "Forum rollback requires the independent database and licensed-bundle restoration procedure; reversing an image cannot restore migrated data",
    );
  if (
    input.kind === "rollback" &&
    env.serviceId === "minecraft" &&
    env.application === "minecraft-tsmc"
  )
    throw new DeliveryError(
      "INVALID",
      "TSMC rollback requires the independent restoration procedure; reversing the server image cannot restore its persistent world",
    );
  const accepted =
    input.kind === "rollback"
      ? required(
          await tx.deployment.findFirst({
            where: {
              environmentId: env.id,
              versionSetRevisionId: input.versionSetRevisionId,
              status: "succeeded",
              kind: { notIn: ["adopt-worker", "repair-trmnl"] },
            },
            orderBy: { finishedAt: "desc" },
          }),
          "Previously accepted rollback deployment",
        )
      : env;
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({
          where: { id: accepted.pipelineRevisionId },
        }),
        "Pipeline",
      ),
    ),
  );
  if (
    env.application === "minecraft-tsmc" &&
    (pipeline.definition.kind !== "argocd" ||
      pipeline.definition.minecraftUpgrade === undefined)
  )
    throw new DeliveryError(
      "INVALID",
      "TSMC deployments require the independent restored-copy preservation pipeline",
    );
  if (
    pipeline.definition.kind === "argocd" &&
    pipeline.definition.minecraftUpgrade !== undefined &&
    input.kind === "rollback"
  )
    throw new DeliveryError(
      "INVALID",
      "Minecraft upgrade rollback requires the independent restoration procedure",
    );
  return {
    pipeline,
    restoredWorkerSnapshot:
      input.kind === "rollback" &&
      "workerSnapshot" in accepted &&
      accepted.workerSnapshot !== null
        ? {
            deploymentId: accepted.id,
            snapshot: WorkerPoolSnapshotSchema.parse(accepted.workerSnapshot),
          }
        : undefined,
    configurationRevision: accepted.configurationRevision,
    configuration: z
      .record(z.string(), z.string())
      .parse(accepted.configuration),
  };
}
