import {
  artifactParameterComponent,
  stepComponents,
  type RecipeDefinition,
  type RunnerReference,
} from "./recipe-contract.ts";

/**
 * What a recipe binds (model 4.7): its components for P3 checks against the
 * owning service, its lock instances (T1) and its runner references (A5),
 * through operator-run and compound wrappers.
 */

/** Components a recipe binds, for P3 checks against the owning service. */
export function recipeComponents(definition: RecipeDefinition): string[] {
  switch (definition.kind) {
    case "kubernetes-application":
      return [
        ...new Set([
          definition.chartComponent,
          ...Object.values(definition.artifactParameters).map((value) =>
            artifactParameterComponent(value),
          ),
          ...definition.steps.flatMap((step) => stepComponents(step)),
          ...(definition.oracle.monitor === undefined
            ? []
            : [definition.oracle.monitor.component]),
        ]),
      ];
    case "static-site":
    case "tofu":
      return [definition.archiveComponent];
    case "channel":
      return [definition.artifactComponent];
    case "operator-run":
      return definition.wrapped.kind === "host"
        ? [...definition.wrapped.components]
        : recipeComponents(definition.wrapped);
    case "compound":
      return [
        ...new Set(
          definition.subRecipes.flatMap((sub) =>
            recipeComponents(sub.definition),
          ),
        ),
      ];
  }
}

/** Lock instances a recipe acts on (T1); each is named by exactly one environment (T6). */
export function recipeInstances(definition: RecipeDefinition): string[] {
  switch (definition.kind) {
    case "kubernetes-application":
      return [...new Set(definition.steps.map((step) => step.instance))];
    case "static-site":
      return [`bucket:${definition.bucket}`];
    case "tofu":
      return [`stack:${definition.stack}`];
    case "channel":
      return [`channel:${definition.store}/${definition.name}`];
    case "operator-run":
      return definition.wrapped.kind === "host"
        ? [definition.wrapped.instance]
        : recipeInstances(definition.wrapped);
    case "compound":
      return [
        ...new Set(
          definition.subRecipes.flatMap((sub) =>
            recipeInstances(sub.definition),
          ),
        ),
      ];
  }
}

/** Runner references a recipe binds (A5). */
export function recipeRunners(definition: RecipeDefinition): RunnerReference[] {
  switch (definition.kind) {
    case "kubernetes-application":
    case "tofu":
      return [definition.runner];
    case "static-site":
    case "channel":
      return [];
    case "operator-run":
      return definition.wrapped.kind === "host"
        ? []
        : recipeRunners(definition.wrapped);
    case "compound":
      return definition.subRecipes.flatMap((sub) =>
        recipeRunners(sub.definition),
      );
  }
}
