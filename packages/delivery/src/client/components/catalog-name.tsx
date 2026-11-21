import type { CatalogService } from "#client/routes/catalog-filter.ts";

/** How a page names catalog ids: a service by its title, an environment by its service's title and its own name. */
export type CatalogNames = {
  service: (id: string) => string;
  environment: (id: string) => string;
};

/**
 * Names for the ids a page shows, from the catalog the overview lists. An id
 * the catalog does not hold (a retired service, a catalog not loaded yet)
 * keeps its id as its name.
 */
export function catalogNames(
  services: readonly CatalogService[],
): CatalogNames {
  const titles = new Map(services.map((entry) => [entry.id, entry.title]));
  const environments = new Map(
    services.flatMap((entry) =>
      entry.environments.map(
        (environment) =>
          [environment.id, `${entry.title} ${environment.name}`] as const,
      ),
    ),
  );
  return {
    service: (id) => titles.get(id) ?? id,
    environment: (id) => environments.get(id) ?? id,
  };
}

/**
 * A catalog name in sight with its slug in the title, so "Prometheus stack
 * prod" and "prometheus/prod" read as one thing. A name that is its slug is
 * shown once.
 */
export function CatalogName({ name, slug }: { name: string; slug: string }) {
  return name === slug ? (
    <span className="mono">{slug}</span>
  ) : (
    <span title={slug}>{name}</span>
  );
}
