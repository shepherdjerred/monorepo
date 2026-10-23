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
 * Only an active environment of an active service admits a deployment, the
 * rebind included. An accepted recipe that deploys an Application with no
 * lifecycle policy (a carried v1 recipe) therefore holds its environment, and
 * its service, active until a rebind accepts a recipe that declares one;
 * otherwise its Application could never be removed (4.10, section 7).
 */
function refuseUnrebindable(
  result: Result,
  entity: {
    id: string;
    to: string;
    environmentId: string;
    application: string;
  },
) {
  result.refused.push({
    id: entity.id,
    reason: `Moving to ${entity.to} is refused while ${entity.environmentId}'s accepted recipe deploys Application ${entity.application} with no lifecycle policy; rebind it to a recipe that declares one first, because only an active environment admits the rebind (4.10, section 7)`,
  });
}

/** Refuses leaving `active` while the environment's accepted Application has no lifecycle policy. */
export async function holdUnrebindable(
  tx: Transaction,
  result: Result,
  environment: { id: string; acceptedDeploymentId: string | null },
  to: string,
) {
  const application = await acceptedApplicationWithoutLifecycle(
    tx,
    environment.acceptedDeploymentId,
  );
  if (application === null) return false;
  refuseUnrebindable(result, {
    id: environment.id,
    to,
    environmentId: environment.id,
    application,
  });
  return true;
}

/** Refuses retiring or removing a service while an active environment of it could no longer be rebound. */
export async function holdUnrebindableService(
  tx: Transaction,
  result: Result,
  serviceId: string,
  to: string,
) {
  for (const environment of await tx.environment.findMany({
    where: { serviceId, lifecycle: "active" },
    select: { id: true, acceptedDeploymentId: true },
    orderBy: { id: "asc" },
  })) {
    const application = await acceptedApplicationWithoutLifecycle(
      tx,
      environment.acceptedDeploymentId,
    );
    if (application === null) continue;
    refuseUnrebindable(result, {
      id: serviceId,
      to,
      environmentId: environment.id,
      application,
    });
    return true;
  }
  return false;
}

/**
 * The lifecycle an environment moves to: the declared one, unless S3 holds
 * it while a deployment is owned, or leaving `active` waits for an accepted
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
  const held =
    declared !== "active" &&
    (await holdUnrebindable(tx, result, existing, declared));
  return held ? LifecycleSchema.parse(existing.lifecycle) : declared;
}
