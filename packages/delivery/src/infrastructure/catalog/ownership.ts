import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
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
