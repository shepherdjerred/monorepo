import { environmentService } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import type { Environment, PipelineRevision } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { primaryApplication } from "#infrastructure/catalog/reconcile.ts";

/** The catalog revision the record was last reconciled to (4.1, C1). */
export type ReconciledCatalog = { revision: string };

/**
 * Handover's reviewed definitions are the catalog as last reconciled into
 * PostgreSQL, never a selected release state. It refuses before any
 * reconciliation, and after a definition was registered outside the
 * catalog since then. That time check is an early, coarse refusal: audit
 * times are transaction start times, so a registration that commits after
 * a reconcile it began before can read as older. The guarantee is
 * `requireCatalogOwnershipDefinition`: registration binds only v1
 * pipelines, and a target is handed over only through a catalog recipe
 * revision naming its own Application.
 */
export async function reconciledCatalog(
  tx: Transaction,
): Promise<ReconciledCatalog> {
  const latest = await tx.audit.findFirst({
    where: { action: "catalog.reconciled" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { entityId: true, occurredAt: true },
  });
  if (latest === null)
    throw new DeliveryError(
      "PAUSED",
      "Ownership handover requires a reconciled catalog; reconcile the catalog first",
    );
  const outside = await tx.audit.count({
    where: {
      action: { in: ["pipeline.registered", "environment.registered"] },
      occurredAt: { gt: latest.occurredAt },
    },
  });
  if (outside > 0)
    throw new DeliveryError(
      "CONFLICT",
      "Definitions were registered outside the catalog after its last reconciliation; reconcile the catalog before handover",
    );
  return { revision: latest.entityId };
}

/**
 * An environment hands over only with the exact binding the reconciled
 * catalog declares: an active service and environment both declared by
 * that revision (an environment the catalog omits keeps an older one), its
 * canonical service id, and the Application its immutable recipe revision
 * names.
 */
export async function requireCatalogOwnershipDefinition(
  tx: Transaction,
  catalog: ReconciledCatalog,
  environment: Environment,
  pipeline: PipelineRevision,
) {
  const [service, declared] = await Promise.all([
    tx.service.findUnique({
      where: { id: environment.serviceId },
      select: { lifecycle: true, catalogRevision: true },
    }),
    tx.environment.findUnique({
      where: { id: environment.id },
      select: { catalogRevision: true },
    }),
  ]);
  const recipe = RecipeDefinitionSchema.safeParse(pipeline.definition);
  if (
    service?.lifecycle !== "active" ||
    service.catalogRevision !== catalog.revision ||
    declared?.catalogRevision !== catalog.revision ||
    environment.lifecycle !== "active" ||
    environment.serviceId !== environmentService(environment.id) ||
    !recipe.success ||
    environment.application !== primaryApplication(recipe.data)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Ownership handover requires the exact environment binding of the reconciled catalog",
    );
}
