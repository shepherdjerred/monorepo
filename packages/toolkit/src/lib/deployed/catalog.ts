/**
 * Service registry for `toolkit deployed`, derived from the ops-model service
 * catalog (`packages/ops-model/services.json`): every catalog service with
 * `deploy` variants is a deployable service here, keyed by its catalog id.
 *
 * The catalog carries only the package↔versionKey↔argoApp wiring, which
 * changes rarely, so bundling it into the compiled binary is fine. Pinned
 * versions are never bundled: versions.ts is read live via git.
 *
 * A drift test (test-integration/catalog.integration.test.ts) checks every
 * versionKey against the live versions.ts on HEAD so the catalog can't
 * silently fall out of sync.
 */
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Service, Variant } from "./types.ts";

const CATALOG_INDEX = new ServiceIndex(SERVICE_CATALOG);

export const SERVICES: Service[] = SERVICE_CATALOG.services
  .filter((service) => service.deploy.length > 0)
  .map((service) => {
    if (service.package === undefined) {
      throw new Error(
        `Service catalog entry ${service.id} has deploy variants but no package`,
      );
    }
    return {
      alias: service.id,
      package: service.package,
      variants: service.deploy.map((variant) => ({
        name: variant.name,
        versionKey: variant.versionKey,
        argoApp: variant.argoApp,
      })),
    };
  });

function findService(name: string): Service | null {
  const lower = name.toLowerCase();
  // Catalog ids and aliases (e.g. "scout", "karma", "worker") first.
  const canonical = CATALOG_INDEX.byId(lower)?.id ?? lower;
  return (
    SERVICES.find((s) => s.alias === canonical) ??
    SERVICES.find((s) => s.package === canonical) ??
    null
  );
}

export type ServiceSelection = {
  service: Service;
  /** When set, restrict to this single variant. */
  variant: Variant | null;
};

/**
 * Resolve a CLI selector like "scout", "scout/prod", "scout-prod", "scout:prod"
 * to a service (and optional variant). Returns null if it isn't a known service.
 */
export function resolveServiceSelector(
  selector: string,
): ServiceSelection | null {
  // Try an explicit variant separator first: "scout/prod" or "scout:prod".
  const sep = /[/:]/.exec(selector);
  if (sep != null) {
    const base = selector.slice(0, sep.index);
    const variantName = selector.slice(sep.index + 1).toLowerCase();
    const service = findService(base);
    if (service == null) {
      return null;
    }
    const variant =
      service.variants.find((v) => v.name === variantName) ?? null;
    return variant == null ? null : { service, variant };
  }

  // Whole-string service match (covers "scout", "birmel", "tasknotes-server").
  const direct = findService(selector);
  if (direct != null) {
    return { service: direct, variant: null };
  }

  // Hyphenated argo-app form: "scout-prod", "starlight-karma-bot-beta".
  const dash = selector.lastIndexOf("-");
  if (dash > 0) {
    const tail = selector.slice(dash + 1).toLowerCase();
    if (tail === "beta" || tail === "prod") {
      const service = findService(selector.slice(0, dash));
      const variant = service?.variants.find((v) => v.name === tail) ?? null;
      if (service != null && variant != null) {
        return { service, variant };
      }
    }
  }

  return null;
}

/** Services whose package matches one of the given changed top-level packages. */
export function servicesForPackages(changed: Iterable<string>): Service[] {
  const set = new Set(changed);
  return SERVICES.filter((s) => set.has(s.package));
}
