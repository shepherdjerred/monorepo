import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema, type Principal } from "#shared/contract.ts";
import { kubernetesRecipes } from "#shared/model/recipe-view.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id } from "#infrastructure/delivery-data.ts";
import { audit, lock, wire } from "#infrastructure/delivery-records.ts";

export const PendingRemovalSchema = z.strictObject({
  environmentId: z.string().min(1),
  applications: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        lifecycle: z.enum(["retain", "cascade"]),
      }),
    )
    .min(1),
});
export const TargetRemovedSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  applications: z.array(z.string().min(1)).min(1),
});
export type TargetRemoved = z.infer<typeof TargetRemovedSchema>;

/**
 * Removed environments whose Applications the executor still has to delete
 * by their recipe's lifecycle policy (4.10, T2): the recipe of the accepted
 * deployment, else the declared one. Owned environments wait.
 */
export async function pendingRemovals(this: Delivery) {
  const environments = await this.database.environment.findMany({
    where: {
      lifecycle: "removed",
      targetRemovedAt: null,
      activeDeploymentId: null,
    },
    include: { acceptedDeployment: true },
    orderBy: { id: "asc" },
  });
  const removals = [];
  for (const env of environments) {
    const recipe = PipelineRevisionSchema.parse(
      wire(
        await this.database.pipeline.findUniqueOrThrow({
          where: {
            id:
              env.acceptedDeployment?.pipelineRevisionId ??
              env.pipelineRevisionId,
          },
        }),
      ),
    );
    const applications = kubernetesRecipes(recipe.definition).map(
      (kubernetes) => ({
        name: kubernetes.application.name,
        lifecycle: kubernetes.application.lifecycle,
      }),
    );
    if (applications.length > 0)
      removals.push(
        PendingRemovalSchema.parse({ environmentId: env.id, applications }),
      );
  }
  return removals;
}

/** The executor observed every Application of a removed environment gone. */
export async function recordTargetRemoved(
  this: Delivery,
  environmentId: string,
  raw: TargetRemoved,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = TargetRemovedSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${environmentId}`);
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    if (env.lifecycle !== "removed")
      throw new DeliveryError(
        "CONFLICT",
        "Only a removed environment has its target state destroyed",
      );
    if (env.targetRemovedAt !== null)
      return { environmentId, removedAt: env.targetRemovedAt.toISOString() };
    const removedAt = new Date(input.observedAt);
    await tx.environment.update({
      where: { id: environmentId },
      data: { targetRemovedAt: removedAt },
    });
    await audit(tx, actor, {
      action: "environment.target_removed",
      entityId: environmentId,
      requestId: id(),
      metadata: input,
    });
    return { environmentId, removedAt: removedAt.toISOString() };
  });
}
