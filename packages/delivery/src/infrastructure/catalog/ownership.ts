import { DeliveryError } from "#domain/error.ts";
import type { z } from "zod";
import { LifecycleSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { acceptedApplicationWithoutLifecycle } from "#infrastructure/execution/removal.ts";
import type { Result } from "./result.ts";

const OWNED = { OR: [{ status: "running" }, { recoveryRequired: true }] };

/** Whether any deployment of the service is owned or recovery-required (S3). */
export async function serviceOwned(tx: Transaction, serviceId: string) {
  return (await tx.deployment.count({ where: { serviceId, ...OWNED } })) > 0;
}

/** Whether the environment is claimed, or a deployment of it is owned or recovery-required (S3). */
export async function environmentOwned(
  tx: Transaction,
  environment: { id: string; activeDeploymentId: string | null },
) {
  return (
    environment.activeDeploymentId !== null ||
    (await tx.deployment.count({
      where: { environmentId: environment.id, ...OWNED },
    })) > 0
  );
}

/** A service whose deployments are owned or quarantined admits no definition change (C4, S3). */
export async function requireUnowned(
  tx: Transaction,
  serviceId: string,
  why: string,
) {
  if (await serviceOwned(tx, serviceId))
    throw new DeliveryError(
      "CONFLICT",
      `${why} is refused while a deployment of ${serviceId} is owned or recovery-required`,
    );
}

/** S3: a lifecycle change waits until nothing of the entity is owned; it is refused, not applied. */
export function refuseLifecycle(
  result: Result,
  entity: { id: string; from: string; to: string },
) {
  result.refused.push({
    id: entity.id,
    reason: `Moving from ${entity.from} to ${entity.to} is refused while a deployment is owned or recovery-required (S3)`,
  });
}

/**
 * The lifecycle an environment moves to: the declared one, unless S3 holds
 * it while a deployment is owned, or its removal waits for an accepted
 * recipe that declares its Application's lifecycle policy (4.10, section 7).
 */
export async function environmentLifecycle(
  tx: Transaction,
  existing: {
    id: string;
    lifecycle: string;
    activeDeploymentId: string | null;
    acceptedDeploymentId: string | null;
  },
  declared: z.infer<typeof LifecycleSchema>,
  result: Result,
) {
  if (existing.lifecycle === declared) return declared;
  if (await environmentOwned(tx, existing)) {
    refuseLifecycle(result, {
      id: existing.id,
      from: existing.lifecycle,
      to: declared,
    });
    return LifecycleSchema.parse(existing.lifecycle);
  }
  const unmanaged =
    declared === "removed"
      ? await acceptedApplicationWithoutLifecycle(
          tx,
          existing.acceptedDeploymentId,
        )
      : null;
  if (unmanaged === null) return declared;
  result.refused.push({
    id: existing.id,
    reason: `Removal is refused while the accepted recipe deploys Application ${unmanaged} with no lifecycle policy; rebind it to a recipe that declares one (4.10, section 7)`,
  });
  return LifecycleSchema.parse(existing.lifecycle);
}
