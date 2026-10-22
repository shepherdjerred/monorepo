import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import {
  CatalogStateSchema,
  RetireServiceRequestSchema,
  ServiceLifecycleViewSchema,
  type RetireServiceRequest,
} from "#shared/model/route-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";

type Reader = Database | Transaction;

/** The catalog revision deployments currently freeze, from the last reconcile (4.1). */
export async function reconciledCatalog(db: Reader) {
  const row = await db.audit.findFirst({
    where: { action: "catalog.reconciled" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  return row === null
    ? null
    : { catalogRevision: row.entityId, reconciledAt: row.occurredAt };
}

/** `GET /catalog`. */
export async function catalogState(db: Reader) {
  const catalog = await reconciledCatalog(db);
  return CatalogStateSchema.parse({
    catalogRevision: catalog?.catalogRevision ?? null,
    reconciledAt: catalog?.reconciledAt.toISOString() ?? null,
  });
}

/**
 * `POST /services/:id/retire` (4.10): the service and each of its active
 * environments retire together. A retired environment admits no deployment
 * and its binding generation moves (E1); removal of the target follows.
 * Replaying the request returns the retired service.
 */
export async function retireService(
  this: Delivery,
  serviceId: string,
  raw: RetireServiceRequest,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RetireServiceRequestSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, "catalog");
    await lock(tx, `service:${serviceId}`);
    const service = required(
      await tx.service.findUnique({ where: { id: serviceId } }),
      "Service",
    );
    if (service.lifecycle !== "active")
      return ServiceLifecycleViewSchema.parse(wire(service));
    const owned = await tx.deployment.count({
      where: {
        serviceId,
        OR: [{ status: "running" }, { recoveryRequired: true }],
      },
    });
    if (owned > 0)
      throw new DeliveryError(
        "CONFLICT",
        `Service ${serviceId} has an owned or recovery-required deployment and cannot retire (S3)`,
      );
    const environments = await tx.environment.findMany({
      where: { serviceId, lifecycle: "active" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    await tx.environment.updateMany({
      where: { serviceId, lifecycle: "active" },
      data: { lifecycle: "retired", generation: { increment: 1 } },
    });
    const retired = await tx.service.update({
      where: { id: serviceId },
      data: { lifecycle: "retired" },
    });
    await audit(tx, actor, {
      action: "catalog.service_retired",
      entityId: serviceId,
      requestId: input.requestId,
      metadata: {
        reason: input.reason,
        environments: environments.map((env) => env.id),
      },
    });
    return ServiceLifecycleViewSchema.parse(wire(retired));
  });
}
