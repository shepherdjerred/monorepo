import { z } from "zod";
import catalogJson from "@shepherdjerred/ops-model/services.json" with { type: "json" };

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const NameListSchema = z.array(z.string().min(1));

export const DeployVariantSchema = z.strictObject({
  name: z.string().min(1),
  versionKey: z.string().min(1),
  argoApp: z.string().min(1),
});
export type DeployVariant = z.infer<typeof DeployVariantSchema>;

export const ServiceSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  kind: z.enum(["product", "workload", "platform"]),
  package: z.string().min(1).optional(),
  aliases: z.array(IdSchema).default([]),
  namespaces: NameListSchema,
  argoApps: NameListSchema,
  bugsinkProjects: NameListSchema.default([]),
  analyticsSites: NameListSchema.default([]),
  grafanaDashboards: NameListSchema.default([]),
  deploy: z.array(DeployVariantSchema).default([]),
});
export type Service = z.infer<typeof ServiceSchema>;

function assertUnique(
  services: readonly Service[],
  pick: (service: Service) => readonly string[],
  what: string,
  context: z.RefinementCtx,
): void {
  const owners = new Map<string, string>();
  for (const service of services) {
    for (const value of pick(service)) {
      const owner = owners.get(value);
      if (owner !== undefined && owner !== service.id) {
        context.addIssue({
          code: "custom",
          message: `${what} ${value} belongs to both ${owner} and ${service.id}`,
        });
      }
      owners.set(value, service.id);
    }
  }
}

export const CatalogSchema = z
  .strictObject({
    $schema: z.string().optional(),
    services: z.array(ServiceSchema).min(1),
  })
  .superRefine((catalog, context) => {
    assertUnique(
      catalog.services,
      (service) => [service.id, ...service.aliases],
      "service id or alias",
      context,
    );
    assertUnique(catalog.services, (s) => s.namespaces, "namespace", context);
    assertUnique(catalog.services, (s) => s.argoApps, "Argo app", context);
    assertUnique(
      catalog.services,
      (s) => s.bugsinkProjects,
      "Bugsink project",
      context,
    );
    assertUnique(
      catalog.services,
      (s) => s.analyticsSites,
      "analytics site",
      context,
    );
  });
export type Catalog = z.infer<typeof CatalogSchema>;

export function parseCatalog(value: unknown): Catalog {
  return CatalogSchema.parse(value);
}

/** The repository's service catalog (`packages/ops-model/services.json`). */
export const SERVICE_CATALOG: Catalog = parseCatalog(catalogJson);

/**
 * Lookup helpers over one catalog. Each returns `undefined` for names that
 * no service claims (e.g. a Bugsink project for a retired app).
 */
export class ServiceIndex {
  readonly #byId = new Map<string, Service>();
  readonly #byNamespace = new Map<string, Service>();
  readonly #byArgoApp = new Map<string, Service>();
  readonly #byBugsinkProject = new Map<string, Service>();
  readonly #byAnalyticsSite = new Map<string, Service>();

  constructor(readonly catalog: Catalog = SERVICE_CATALOG) {
    for (const service of catalog.services) {
      for (const key of [service.id, ...service.aliases]) {
        this.#byId.set(key, service);
      }
      for (const namespace of service.namespaces) {
        this.#byNamespace.set(namespace, service);
      }
      for (const app of service.argoApps) {
        this.#byArgoApp.set(app, service);
      }
      for (const project of service.bugsinkProjects) {
        this.#byBugsinkProject.set(project, service);
      }
      for (const site of service.analyticsSites) {
        this.#byAnalyticsSite.set(site, service);
      }
    }
  }

  get services(): readonly Service[] {
    return this.catalog.services;
  }

  /** Resolve an id or alias. */
  byId(idOrAlias: string): Service | undefined {
    return this.#byId.get(idOrAlias.toLowerCase());
  }

  /** Resolve an id or alias; an unknown id is a broken internal contract. */
  requireById(idOrAlias: string): Service {
    const service = this.byId(idOrAlias);
    if (service === undefined) {
      throw new Error(`Unknown service ${idOrAlias}`);
    }
    return service;
  }

  byNamespace(namespace: string): Service | undefined {
    return this.#byNamespace.get(namespace);
  }

  byArgoApp(app: string): Service | undefined {
    return this.#byArgoApp.get(app);
  }

  byBugsinkProject(slug: string): Service | undefined {
    return this.#byBugsinkProject.get(slug);
  }

  byAnalyticsSite(key: string): Service | undefined {
    return this.#byAnalyticsSite.get(key);
  }
}
