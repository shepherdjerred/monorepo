import type { z } from "zod";
import {
  type CatalogComponent,
  type CatalogDocumentBase,
  CatalogDocumentBaseSchema,
  type CatalogEnvironment,
  type CatalogService,
  componentType,
  environmentService,
} from "./catalog-document-shape.ts";

/**
 * The one Git-owned catalog (Delivery model, section 4.1): services with
 * their typed components, environments, recipe and configuration revisions
 * as candidates, and prerequisite edges. `catalog-document.schema.json` is
 * the language-neutral structural contract, `catalog-document-shape.ts`
 * mirrors it, and this module adds the cross-field rules a JSON Schema
 * cannot express.
 *
 * The catalog contains no artifact digest, version string, chart revision or
 * image tag of anything that runs (C2). Delivery records what is deployed.
 */

type Path = (string | number)[];
type Check = {
  services: Map<string, CatalogService>;
  environments: Map<string, CatalogEnvironment>;
  recipes: Set<string>;
  configurations: Set<string>;
  context: z.RefinementCtx;
};

function checker(
  document: CatalogDocumentBase,
  context: z.RefinementCtx,
): Check {
  return {
    services: new Map(
      document.services.map((service) => [service.id, service]),
    ),
    environments: new Map(
      document.environments.map((environment) => [environment.id, environment]),
    ),
    recipes: new Set(document.recipes.map((recipe) => recipe.id)),
    configurations: new Set(
      document.configurations.map((configuration) => configuration.id),
    ),
    context,
  };
}

function issue(check: Check, path: Path, message: string): void {
  check.context.addIssue({ code: "custom", path, message });
}

function uniqueIds(check: Check, section: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      issue(check, [section, index, "id"], `Duplicate ${section} id ${id}`);
    }
    seen.add(id);
  }
}

function refineReference(
  service: CatalogService,
  component: CatalogComponent,
  path: Path,
  check: Check,
): void {
  const source = component.source;
  if (source === undefined) {
    return;
  }
  const owner = check.services.get(source.service);
  if (owner === undefined || owner.id === service.id) {
    issue(
      check,
      [...path, "source", "service"],
      `Reference ${component.name} on ${service.id} must name another catalog service`,
    );
    return;
  }
  const target = owner.components.find(
    (candidate) => candidate.name === source.component,
  );
  if (
    target === undefined ||
    componentType(target.name) !== componentType(component.name)
  ) {
    issue(
      check,
      [...path, "source", "component"],
      `Reference ${component.name} on ${service.id} must name an existing ${componentType(component.name)} component of ${owner.id}`,
    );
  }
  if (
    source.environment !== undefined &&
    (!check.environments.has(source.environment) ||
      environmentService(source.environment) !== owner.id)
  ) {
    issue(
      check,
      [...path, "source", "environment"],
      `Tracking reference ${component.name} on ${service.id} must follow an environment of ${owner.id}`,
    );
  }
}

/** A group may share its id with a service only when that service belongs to it. */
function refineGroupIds(document: CatalogDocumentBase, check: Check): void {
  uniqueIds(
    check,
    "groups",
    document.groups.map((group) => group.id),
  );
  for (const [index, group] of document.groups.entries()) {
    const member = check.services.get(group.id);
    if (member !== undefined && member.group !== group.id) {
      issue(
        check,
        ["groups", index, "id"],
        `Group ${group.id} shares its id with a service that belongs to group ${member.group}`,
      );
    }
  }
}

/** Aliases are unique and collide with no group id and no service id. */
function refineGroupAliases(document: CatalogDocumentBase, check: Check): void {
  const taken = new Map<string, string>(
    document.groups.map((group) => [group.id, `group ${group.id}`]),
  );
  for (const service of check.services.keys()) {
    taken.set(service, `service ${service}`);
  }
  for (const [index, group] of document.groups.entries()) {
    for (const [aliasIndex, alias] of group.aliases.entries()) {
      const holder = taken.get(alias);
      if (holder !== undefined) {
        issue(
          check,
          ["groups", index, "aliases", aliasIndex],
          `Alias ${alias} of group ${group.id} collides with ${holder}`,
        );
      }
      taken.set(alias, `alias of group ${group.id}`);
    }
  }
}

/** Groups are the ops views; every service names one. */
function refineGroups(document: CatalogDocumentBase, check: Check): void {
  refineGroupIds(document, check);
  refineGroupAliases(document, check);
  const groups = new Set(document.groups.map((group) => group.id));
  for (const [index, service] of document.services.entries()) {
    if (!groups.has(service.group)) {
      issue(
        check,
        ["services", index, "group"],
        `Service ${service.id} names undeclared group ${service.group}`,
      );
    }
  }
}

function refineServices(document: CatalogDocumentBase, check: Check): void {
  uniqueIds(
    check,
    "services",
    document.services.map((service) => service.id),
  );
  if (!document.services.some((service) => service.selfHosted)) {
    issue(
      check,
      ["services"],
      "The catalog declares the self-hosted services whose deployments take the dispatch barrier (D8); none is marked selfHosted",
    );
  }
  for (const [serviceIndex, service] of document.services.entries()) {
    const names = new Set<string>();
    for (const [componentIndex, component] of service.components.entries()) {
      const path = ["services", serviceIndex, "components", componentIndex];
      if (names.has(component.name)) {
        issue(
          check,
          path,
          `Component ${component.name} is declared twice on ${service.id}`,
        );
      }
      names.add(component.name);
      refineReference(service, component, path, check);
    }
  }
}

function refinePromotionSource(
  environment: CatalogEnvironment,
  path: Path,
  check: Check,
): void {
  const sourceId = environment.promotionSourceEnvironmentId;
  if (sourceId === undefined) {
    return;
  }
  const serviceId = environmentService(environment.id);
  const source = check.environments.get(sourceId);
  if (
    source === undefined ||
    sourceId === environment.id ||
    environmentService(sourceId) !== serviceId
  ) {
    issue(
      check,
      [...path, "promotionSourceEnvironmentId"],
      `Promotion source ${sourceId} of ${environment.id} must be another environment of ${serviceId} (E6)`,
    );
  } else if (source.role === "replica") {
    issue(
      check,
      [...path, "promotionSourceEnvironmentId"],
      `Replica ${sourceId} holds no acceptance and cannot be a promotion source (E7)`,
    );
  }
}

function refineEnvironment(
  environment: CatalogEnvironment,
  path: Path,
  check: Check,
): void {
  const serviceId = environmentService(environment.id);
  if (!check.services.has(serviceId)) {
    issue(
      check,
      [...path, "id"],
      `Environment ${environment.id} names unknown service ${serviceId}`,
    );
  }
  if (!check.recipes.has(environment.recipeRevisionId)) {
    issue(
      check,
      [...path, "recipeRevisionId"],
      `Environment ${environment.id} names unknown recipe revision ${environment.recipeRevisionId}`,
    );
  }
  if (!check.configurations.has(environment.configurationRevisionId)) {
    issue(
      check,
      [...path, "configurationRevisionId"],
      `Environment ${environment.id} names unknown configuration revision ${environment.configurationRevisionId}`,
    );
  }
  const parent =
    environment.durableParent === undefined
      ? undefined
      : check.environments.get(environment.durableParent);
  if (
    environment.durableParent !== undefined &&
    (parent?.role !== "durable" || environmentService(parent.id) !== serviceId)
  ) {
    issue(
      check,
      [...path, "durableParent"],
      `Replica ${environment.id} must mirror a durable environment of ${serviceId}`,
    );
  }
  refinePromotionSource(environment, path, check);
}

function refineEnvironments(document: CatalogDocumentBase, check: Check): void {
  uniqueIds(
    check,
    "environments",
    document.environments.map((environment) => environment.id),
  );
  for (const [position, environment] of document.environments.entries()) {
    const path = ["environments", position];
    refineEnvironment(environment, path, check);
    const visited = new Set<string>([environment.id]);
    let cursor = environment.promotionSourceEnvironmentId;
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        issue(
          check,
          [...path, "promotionSourceEnvironmentId"],
          `Promotion edges of ${environment.id} form a cycle through ${cursor} (E6)`,
        );
        break;
      }
      visited.add(cursor);
      cursor = check.environments.get(cursor)?.promotionSourceEnvironmentId;
    }
  }
}

function findCycle(dependents: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, trail: string[]): string[] | undefined => {
    const mark = state.get(node);
    if (mark === "visiting") {
      return [...trail, node];
    }
    if (mark === "done") {
      return undefined;
    }
    state.set(node, "visiting");
    for (const next of dependents.get(node) ?? []) {
      const cycle = visit(next, [...trail, node]);
      if (cycle !== undefined) {
        return cycle;
      }
    }
    state.set(node, "done");
    return undefined;
  };
  for (const node of dependents.keys()) {
    const cycle = visit(node, []);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
}

function refineEdges(document: CatalogDocumentBase, check: Check): void {
  const pairs = new Set<string>();
  const dependents = new Map<string, string[]>();
  for (const [position, edge] of document.edges.entries()) {
    const path = ["edges", position];
    for (const side of ["dependent", "prerequisite"] as const) {
      if (!check.environments.has(edge[side])) {
        issue(
          check,
          [...path, side],
          `Edge names unknown environment ${edge[side]}`,
        );
      }
    }
    if (edge.dependent === edge.prerequisite) {
      issue(
        check,
        path,
        `Environment ${edge.dependent} cannot be its own prerequisite`,
      );
    }
    const pair = `${edge.prerequisite} -> ${edge.dependent}`;
    if (pairs.has(pair)) {
      issue(check, path, `Duplicate prerequisite edge ${pair}`);
    }
    pairs.add(pair);
    dependents.set(edge.prerequisite, [
      ...(dependents.get(edge.prerequisite) ?? []),
      edge.dependent,
    ]);
  }
  const cycle = findCycle(dependents);
  if (cycle !== undefined) {
    issue(
      check,
      ["edges"],
      `Prerequisite edges must form a DAG (Z2); cycle ${cycle.join(" -> ")}`,
    );
  }
}

const runningVersionPatterns = [
  { name: "a content digest", pattern: /sha256:[a-f0-9]{64}/u },
  { name: "a build-numbered chart version", pattern: /^\d+\.\d+\.\d+-\d+$/u },
];

function walkStrings(
  value: unknown,
  path: Path,
  visit: (text: string, path: Path) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
  } else if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      walkStrings(entry, [...path, index], visit);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      walkStrings(entry, [...path, key], visit);
    }
  }
}

/** C2: nothing that identifies running bytes lives in the catalog. */
function refineNoRunningVersions(
  document: CatalogDocumentBase,
  check: Check,
): void {
  walkStrings(document, [], (text, path) => {
    for (const { name, pattern } of runningVersionPatterns) {
      if (pattern.test(text)) {
        issue(
          check,
          path,
          `The catalog carries ${name}; versions of what runs belong to Delivery (C2)`,
        );
      }
    }
  });
}

/** Cross-field rules shared by this package and Delivery's typed catalog. */
export function refineCatalogDocument(
  document: CatalogDocumentBase,
  context: z.RefinementCtx,
): void {
  const check = checker(document, context);
  refineNoRunningVersions(document, check);
  uniqueIds(
    check,
    "recipes",
    document.recipes.map((recipe) => recipe.id),
  );
  uniqueIds(
    check,
    "configurations",
    document.configurations.map((configuration) => configuration.id),
  );
  refineGroups(document, check);
  refineServices(document, check);
  refineEnvironments(document, check);
  refineEdges(document, check);
}

export const CatalogDocumentSchema = CatalogDocumentBaseSchema.superRefine(
  refineCatalogDocument,
);
export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>;

export function parseCatalogDocument(value: unknown): CatalogDocument {
  return CatalogDocumentSchema.parse(value);
}
