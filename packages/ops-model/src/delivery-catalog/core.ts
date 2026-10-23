import type { z } from "zod";
import core from "@shepherdjerred/ops-model/catalog-document.json" with { type: "json" };
import {
  CatalogDocumentBaseSchema,
  componentType,
  type CatalogService,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";

/**
 * The reviewed core of the catalog document (Delivery model, section 4.1):
 * groups, services, environments, prerequisite edges and the transitional
 * legacy material, from `catalog-document.json`. Recipe and configuration
 * revisions live beside the Delivery registrations
 * (`packages/delivery/registrations/v2/`) because a generator serialises them
 * from the homelab Application constructors; `catalog-document-files.ts`
 * assembles the complete document that `parseCatalogDocument` validates.
 */
export const CatalogCoreSchema = CatalogDocumentBaseSchema.omit({
  recipes: true,
  configurations: true,
});
export type CatalogCore = z.infer<typeof CatalogCoreSchema>;

export const CATALOG_CORE: CatalogCore = CatalogCoreSchema.parse(core);

/** Every service the catalog declares, by id. */
export function catalogService(
  serviceId: string,
  catalog: CatalogCore = CATALOG_CORE,
): CatalogService | undefined {
  return catalog.services.find((service) => service.id === serviceId);
}

/** Whether the catalog declares a service; producers register builds only for declared services (C1). */
export function catalogOwnsService(
  serviceId: string,
  catalog: CatalogCore = CATALOG_CORE,
): boolean {
  return catalogService(serviceId, catalog) !== undefined;
}

/**
 * The service whose first-party component carries this name: the service a
 * CI build of that image, chart or archive registers under. Acquired
 * components are per service (two services may each acquire `chart:alloy`)
 * and references never own the bytes they name (A5), so neither is an owner.
 */
export function firstPartyOwner(
  componentName: string,
  catalog: CatalogCore = CATALOG_CORE,
): CatalogService | undefined {
  const owners = catalog.services.filter((service) =>
    service.components.some(
      (component) =>
        component.name === componentName &&
        component.producer === "first-party",
    ),
  );
  if (owners.length > 1)
    throw new Error(
      `First-party ${componentType(componentName)} ${componentName} is produced by ${owners.map((owner) => owner.id).join(" and ")}`,
    );
  return owners[0];
}
