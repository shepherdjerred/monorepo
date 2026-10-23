import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema, type Principal } from "#shared/contract.ts";
import {
  DriftObservationSchema,
  SelfHealingSchema,
  type DriftObservation,
} from "#shared/model/monitor-contract.ts";
import { selfHealingApplications } from "#shared/model/recipe-view.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { evidence } from "#infrastructure/delivery-data.ts";
import { lock, required, wire } from "#infrastructure/delivery-records.ts";

/** Accepted deployments whose recipe asks ArgoCD to self-heal the accepted source (T4). */
export async function selfHealing(this: Delivery) {
  const environments = await this.database.environment.findMany({
    where: { acceptedDeploymentId: { not: null }, lifecycle: "active" },
    include: { acceptedDeployment: true, service: true },
    orderBy: { id: "asc" },
  });
  const watched = [];
  for (const env of environments) {
    const accepted = required(env.acceptedDeployment, "Accepted deployment");
    const recipe = PipelineRevisionSchema.parse(
      wire(
        await this.database.pipeline.findUniqueOrThrow({
          where: { id: accepted.pipelineRevisionId },
        }),
      ),
    );
    const acceptedAt = required(
      accepted.finishedAt,
      "Acceptance time",
    ).toISOString();
    for (const application of selfHealingApplications(
      recipe.definition,
      env.service,
    ))
      watched.push(
        SelfHealingSchema.parse({
          deploymentId: accepted.id,
          environmentId: env.id,
          application: application.name,
          acceptedAt,
        }),
      );
  }
  return watched;
}

/** Records one self-heal as drift evidence on the accepted deployment it reverted to (T4, V3). */
export async function recordDrift(
  this: Delivery,
  deploymentId: string,
  raw: DriftObservation,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = DriftObservationSchema.parse(raw);
  await this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = await tx.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: row.environmentId },
    });
    if (env.acceptedDeploymentId !== row.id)
      throw new DeliveryError(
        "CONFLICT",
        "Drift is evidence of the accepted deployment only",
      );
    await evidence(
      tx,
      deploymentId,
      [
        {
          kind: "drift",
          operationId: input.startedAt,
          summary: JSON.stringify(input),
        },
      ],
      { prefix: "drift", appendOnly: true },
    );
  });
  return input;
}
