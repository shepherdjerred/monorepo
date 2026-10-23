/**
 * Catalog fixtures for publication tests.
 *
 * The per-site and per-stack Delivery services are added to the committed
 * catalog by their own change; until then these fixtures extend the live
 * catalog with the service ids the producers derive, so the tests exercise
 * exactly the shape registration will see.
 */
import {
  parseCatalog,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";
import { tofuArchiveServiceId } from "../../tofu-archive.ts";
import { staticSiteServiceId } from "../static-site-publications.ts";

/** Scout's frontends publish under the Scout service and never get a service of their own. */
const COMBINED_DEPLOYMENT_BUCKETS = new Set([
  "scout-frontend",
  "scout-frontend-beta",
]);

export const INDEPENDENT_SITE_BUCKETS: readonly string[] = Object.keys(
  STATIC_SITE_DESTINATIONS,
).filter((bucket) => !COMBINED_DEPLOYMENT_BUCKETS.has(bucket));

export function catalogWithServices(
  ids: readonly string[],
  base: Catalog = SERVICE_CATALOG,
): Catalog {
  return parseCatalog({
    ...base,
    services: [
      ...base.services,
      ...ids.map((id) => ({
        id,
        title: id,
        kind: "product",
        namespaces: [],
        argoApps: [],
      })),
    ],
  });
}

export function staticSiteCatalog(base: Catalog = SERVICE_CATALOG): Catalog {
  return catalogWithServices(
    INDEPENDENT_SITE_BUCKETS.map((bucket) => staticSiteServiceId(bucket)),
    base,
  );
}

export function tofuArchiveCatalog(base: Catalog = SERVICE_CATALOG): Catalog {
  return catalogWithServices(
    TofuStackSchema.options.map((stack) => tofuArchiveServiceId(stack)),
    base,
  );
}
