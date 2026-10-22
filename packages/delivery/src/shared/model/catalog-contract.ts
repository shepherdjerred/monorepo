import { z } from "zod";
import {
  catalogDocumentShape,
  environmentService,
  RevisionIdSchema,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { refineCatalogDocument } from "@shepherdjerred/ops-model/catalog-document.ts";
import {
  type ArtifactParameter,
  type RecipeDefinition,
  RecipeDefinitionSchema,
} from "./recipe-contract.ts";
import {
  recipeComponents,
  recipeInstances,
  recipeRunners,
} from "./recipe-bindings.ts";

/**
 * The catalog document (model 4.1) as Delivery reads it: the ops-model
 * structure with every recipe body typed by `RecipeDefinitionSchema`, plus
 * the binding rules between recipes and the services that own them (P3).
 * `@shepherdjerred/ops-model/catalog-document.schema.json` is the
 * language-neutral source of truth for the structure.
 */
export const RecipeRevisionSchema = z.strictObject({
  id: RevisionIdSchema,
  definition: RecipeDefinitionSchema,
});
export type RecipeRevision = z.infer<typeof RecipeRevisionSchema>;

const CatalogDocumentBaseSchema = z.strictObject({
  ...catalogDocumentShape,
  recipes: z.array(RecipeRevisionSchema),
});
type CatalogDocumentBase = z.infer<typeof CatalogDocumentBaseSchema>;

/** P3: a recipe binds only components of its own service; runners resolve to an image of the named service (A5). */
function refineRecipeBindings(
  document: CatalogDocumentBase,
  context: z.RefinementCtx,
): void {
  const components = new Map(
    document.services.map((service) => [
      service.id,
      new Set(service.components.map((component) => component.name)),
    ]),
  );
  const recipes = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe.definition]),
  );
  for (const [index, environment] of document.environments.entries()) {
    const definition = recipes.get(environment.recipeRevisionId);
    const owned = components.get(environmentService(environment.id));
    if (definition === undefined || owned === undefined) {
      continue;
    }
    for (const component of recipeComponents(definition)) {
      if (!owned.has(component)) {
        context.addIssue({
          code: "custom",
          path: ["environments", index, "recipeRevisionId"],
          message: `Recipe ${environment.recipeRevisionId} binds ${component}, which ${environmentService(environment.id)} does not declare (P3)`,
        });
      }
    }
    for (const runner of recipeRunners(definition)) {
      if (components.get(runner.service)?.has(runner.component) !== true) {
        context.addIssue({
          code: "custom",
          path: ["environments", index, "recipeRevisionId"],
          message: `Recipe ${environment.recipeRevisionId} runs on ${runner.service} ${runner.component}, which the catalog does not declare (A5)`,
        });
      }
    }
  }
}

/** T6: a target instance is named by exactly one environment of one service. */
function refineInstanceOwnership(
  document: CatalogDocumentBase,
  context: z.RefinementCtx,
): void {
  const recipes = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe.definition]),
  );
  const owners = new Map<string, string>();
  for (const [index, environment] of document.environments.entries()) {
    const definition = recipes.get(environment.recipeRevisionId);
    if (definition === undefined) {
      continue;
    }
    for (const instance of recipeInstances(definition)) {
      const owner = owners.get(instance);
      if (owner !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["environments", index, "recipeRevisionId"],
          message: `Instance ${instance} is named by both ${owner} and ${environment.id} (T6)`,
        });
      }
      owners.set(instance, environment.id);
    }
  }
}

/** Every Application body a recipe declares, through operator-run and compound wrappers. */
export function recipeApplications(definition: RecipeDefinition): {
  project: string;
  parameters: Record<string, ArtifactParameter>;
}[] {
  switch (definition.kind) {
    case "kubernetes-application":
      return [
        {
          project: definition.application.project,
          parameters: definition.artifactParameters,
        },
      ];
    case "operator-run":
      return definition.wrapped.kind === "host"
        ? []
        : recipeApplications(definition.wrapped);
    case "compound":
      return definition.subRecipes.flatMap((sub) =>
        recipeApplications(sub.definition),
      );
    case "static-site":
    case "tofu":
    case "channel":
      return [];
  }
}

type BindingCheck = {
  projectOwners: Map<string, string>;
  environments: Set<string>;
  prerequisites: Map<string, Set<string>>;
  context: z.RefinementCtx;
};

/**
 * An Application names an AppProject some service owns, and its environment
 * deploys after an environment of that owner (Z3). ArgoCD creates its own
 * `default` project, which needs no owner.
 */
function refineProject(
  environmentId: string,
  project: string,
  path: (string | number)[],
  check: BindingCheck,
): void {
  if (project === "default") return;
  const owner = check.projectOwners.get(project);
  const serviceId = environmentService(environmentId);
  if (owner === undefined) {
    check.context.addIssue({
      code: "custom",
      path,
      message: `${environmentId} names AppProject ${project}, which no catalog service owns`,
    });
    return;
  }
  const prerequisites = check.prerequisites.get(environmentId) ?? new Set();
  if (
    owner !== serviceId &&
    ![...prerequisites].some((id) => environmentService(id) === owner)
  )
    check.context.addIssue({
      code: "custom",
      path,
      message: `${environmentId} needs a prerequisite edge to an environment of ${owner}, which owns AppProject ${project} (Z3)`,
    });
}

function refineApplicationBindings(
  document: CatalogDocumentBase,
  context: z.RefinementCtx,
): void {
  const prerequisites = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    const known = prerequisites.get(edge.dependent) ?? new Set<string>();
    prerequisites.set(edge.dependent, known.add(edge.prerequisite));
  }
  const check: BindingCheck = {
    projectOwners: new Map(
      document.services.flatMap((service) =>
        (service.appProjects ?? []).map((project) => [project, service.id]),
      ),
    ),
    environments: new Set(document.environments.map((env) => env.id)),
    prerequisites,
    context,
  };
  const recipes = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe.definition]),
  );
  for (const [index, environment] of document.environments.entries()) {
    const definition = recipes.get(environment.recipeRevisionId);
    if (definition === undefined) continue;
    const path = ["environments", index, "recipeRevisionId"];
    for (const application of recipeApplications(definition)) {
      refineProject(environment.id, application.project, path, check);
    }
  }
}

export const CatalogDocumentSchema = CatalogDocumentBaseSchema.superRefine(
  (document, context) => {
    refineCatalogDocument(document, context);
    refineRecipeBindings(document, context);
    refineInstanceOwnership(document, context);
    refineApplicationBindings(document, context);
  },
);
export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The lineage of a component list (4.6, S1): hex sha256 over the component
 * names sorted and joined by a newline, so catalog order is presentational
 * and the SQL backfill can compute the same value with
 * `encode(sha256(convert_to(string_agg(name, E'\n' ORDER BY name), 'UTF8')), 'hex')`.
 */
export function serviceLineage(
  componentNames: readonly string[],
): Promise<string> {
  return sha256Hex([...componentNames].toSorted().join("\n"));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => canonicalValue(entry));
  }
  return typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, entry]) => [key, canonicalValue(entry)]),
      )
    : value;
}

/** JSON with object keys sorted at every depth, so equal documents serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/**
 * The fingerprint a deployment freezes as its catalog revision (4.1):
 * `sha256:` over the canonical JSON of the parsed document. Web Crypto keeps
 * the contract usable from the hub as well as the API.
 */
export async function catalogRevision(
  document: CatalogDocument,
): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(document))}`;
}
