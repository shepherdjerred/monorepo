import {
  SERVICE_CATALOG,
  ServiceIndex,
  type Catalog,
} from "@shepherdjerred/ops-model/catalog.ts";
import {
  CATALOG_CORE,
  type CatalogCore,
  catalogOwnsService,
  firstPartyOwner,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";

/**
 * The registry that names a CI build's Delivery owner. Producers keep v1's
 * `services.json` groups until the cutover window turns
 * `woodpecker-delivery-catalog-v2-enabled` on together with publication
 * (window step 8); from then on every build registers under the catalog
 * document's first-party owner. WP4 deletes the flag and the v1 branch.
 */
export type OwnerRegistry = "v1" | "v2";

/**
 * Charts the v2 catalog no longer registers. `apps` is v1's root release,
 * which the window orphans; v1 keeps registering it for the final v1 root
 * release.
 */
const V2_UNREGISTERED_CHARTS: ReadonlySet<string> = new Set(["apps"]);

export type PublicationOwners = {
  readonly registry: OwnerRegistry;
  /** The owner of a first-party chart's build, or undefined when the registry no longer registers it. */
  chart: (name: string) => string | undefined;
  /** The owner of a first-party image's build. */
  image: (name: string) => string;
  /** Whether the registry declares the service. */
  owns: (serviceId: string) => boolean;
};

export function publicationOwners(
  registry: OwnerRegistry,
  sources: { catalog?: Catalog; core?: CatalogCore } = {},
): PublicationOwners {
  if (registry === "v1") {
    const catalog = sources.catalog ?? SERVICE_CATALOG;
    const index = new ServiceIndex(catalog);
    return {
      registry,
      chart(name) {
        const owner = index.byChart(name);
        if (owner === undefined)
          throw new Error(`Chart ${name} requires a service catalog owner`);
        return owner.id;
      },
      image(name) {
        const owner = index.byImage(name);
        if (owner === undefined)
          throw new Error(
            `Image shepherdjerred/${name} requires a service catalog owner`,
          );
        return owner.id;
      },
      owns: (serviceId) =>
        catalog.services.some((service) => service.id === serviceId),
    };
  }
  const core = sources.core ?? CATALOG_CORE;
  return {
    registry,
    chart(name) {
      if (V2_UNREGISTERED_CHARTS.has(name)) return;
      const owner = firstPartyOwner(`chart:${name}`, core);
      if (owner === undefined)
        throw new Error(`Chart ${name} has no first-party catalog owner`);
      return owner.id;
    },
    image(name) {
      const owner = firstPartyOwner(`image:${name}`, core);
      if (owner === undefined)
        throw new Error(
          `Image shepherdjerred/${name} has no first-party catalog owner`,
        );
      return owner.id;
    },
    owns: (serviceId) => catalogOwnsService(serviceId, core),
  };
}
