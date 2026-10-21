import {
  LegacyPipelineRevisionSchema,
  WorkerPoolSnapshotSchema,
  type CreateDeployment,
  type Environment,
} from "#shared/contract.ts";
import { required, wire } from "./delivery-records.ts";
import { configurationRevision, type Transaction } from "./delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";

/**
 * The selection a request freezes: the environment's declared recipe and
 * configuration revisions for a deploy or promote, the previously accepted
 * selection for a rollback (model 4.9, P2, F1).
 */
async function pipelineRevision(tx: Transaction, id: string) {
  return LegacyPipelineRevisionSchema.parse(
    wire(required(await tx.pipeline.findUnique({ where: { id } }), "Pipeline")),
  );
}

/** A step past its point of no return is not reversible by reselecting bytes (D9). */
function refuseIrreversibleRollback(
  pipeline: Awaited<ReturnType<typeof pipelineRevision>>,
  input: CreateDeployment,
) {
  if (
    pipeline.definition.kind === "argocd" &&
    pipeline.definition.minecraftUpgrade !== undefined &&
    input.kind === "rollback"
  )
    throw new DeliveryError(
      "INVALID",
      "Minecraft upgrade rollback requires the independent restoration procedure",
    );
}

export async function deploymentSelection(
  tx: Transaction,
  input: CreateDeployment,
  env: Environment,
) {
  refuseIrreversibleRollback(
    await pipelineRevision(tx, env.pipelineRevisionId),
    input,
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
      : null;
  const pipeline = await pipelineRevision(
    tx,
    accepted?.pipelineRevisionId ?? env.pipelineRevisionId,
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
  refuseIrreversibleRollback(pipeline, input);
  return {
    pipeline,
    restoredDeploymentId: accepted?.id ?? null,
    restoredWorkerSnapshot:
      accepted !== null && accepted.workerSnapshot !== null
        ? {
            deploymentId: accepted.id,
            snapshot: WorkerPoolSnapshotSchema.parse(accepted.workerSnapshot),
          }
        : undefined,
    configuration: await configurationRevision(
      tx,
      accepted?.configurationId ?? env.declaredConfigurationId,
    ),
  };
}
