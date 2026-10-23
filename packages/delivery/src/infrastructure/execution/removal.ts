import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema, type Principal } from "#shared/contract.ts";
import type { StoredRecipeDefinition } from "#shared/model/record-contract.ts";
import { applicationOf, kubernetesRecipes } from "#shared/model/recipe-view.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";
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
 * The Application a recipe deploys with no lifecycle policy: a carried v1
 * `argocd` or a `control-plane` recipe (section 7). Removal deletes an
 * Application only by its recipe's policy (4.10), so such an environment is
 * not removed until a rebind freezes a recipe that declares one.
 */
function applicationWithoutLifecycle(definition: StoredRecipeDefinition) {
  return kubernetesRecipes(definition).length === 0
    ? (applicationOf(definition)?.name ?? null)
    : null;
}

/** The Application the accepted deployment's recipe deploys with no lifecycle policy. */
export async function acceptedApplicationWithoutLifecycle(
  tx: Transaction,
  acceptedDeploymentId: string | null,
) {
  if (acceptedDeploymentId === null) return null;
  const accepted = await tx.deployment.findUniqueOrThrow({
    where: { id: acceptedDeploymentId },
    select: { pipelineRevisionId: true },
  });
  const recipe = PipelineRevisionSchema.parse(
    wire(
      await tx.pipeline.findUniqueOrThrow({
        where: { id: accepted.pipelineRevisionId },
      }),
    ),
  );
  return applicationWithoutLifecycle(recipe.definition);
}

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
    // The catalog refuses this removal, so reaching it breaks the record.
    const unmanaged = applicationWithoutLifecycle(recipe.definition);
    if (unmanaged !== null)
      throw new Error(
        `Removed environment ${env.id} deploys Application ${unmanaged} with no lifecycle policy`,
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
