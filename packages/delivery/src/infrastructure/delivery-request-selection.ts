import { z } from "zod";
import {
  PipelineRevisionSchema,
  type CreateDeployment,
  type Environment,
} from "#shared/contract.ts";
import { required, wire } from "./delivery-records.ts";
import type { Transaction } from "./delivery-data.ts";

/** Rollback restores a proven complete release, including its frozen settings. */
export async function deploymentSelection(
  tx: Transaction,
  input: CreateDeployment,
  env: Environment,
) {
  const accepted =
    input.kind === "rollback"
      ? required(
          await tx.deployment.findFirst({
            where: {
              environmentId: env.id,
              versionSetRevisionId: input.versionSetRevisionId,
              status: "succeeded",
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
  return {
    pipeline,
    configurationRevision: accepted.configurationRevision,
    configuration: z
      .record(z.string(), z.string())
      .parse(accepted.configuration),
  };
}
