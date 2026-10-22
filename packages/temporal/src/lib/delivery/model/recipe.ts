import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  RecipeDefinitionSchema,
  stepStageKey,
  type KubernetesStep,
  type RecipeDefinition,
} from "@shepherdjerred/delivery/model-contract";

/** Recipes the model executor runs; a static-site recipe keeps the shared site adapter. */
export type ModelRecipe = Exclude<RecipeDefinition, { kind: "static-site" }>;
export type KubernetesApplicationRecipe = Extract<
  RecipeDefinition,
  { kind: "kubernetes-application" }
>;
export type TofuRecipe = Extract<RecipeDefinition, { kind: "tofu" }>;
export type ChannelRecipe = Extract<RecipeDefinition, { kind: "channel" }>;
export type OperatorRunRecipe = Extract<
  RecipeDefinition,
  { kind: "operator-run" }
>;

/** The model recipe a deployment froze, or null for a v1 pipeline. */
export function modelRecipe(detail: DeploymentDetail): ModelRecipe | null {
  const parsed = RecipeDefinitionSchema.safeParse(detail.pipeline.definition);
  if (!parsed.success) return null;
  return parsed.data.kind === "static-site" ? null : parsed.data;
}

export function requireModelRecipe(detail: DeploymentDetail): ModelRecipe {
  const recipe = modelRecipe(detail);
  if (recipe === null)
    throw new Error(
      `Deployment ${detail.deployment.id} froze no model recipe for the step executor`,
    );
  return recipe;
}

/** One frozen step: its stage key, and what runs it (T3). */
export type ModelStep =
  | { key: string; adapter: "kubernetes"; step: KubernetesStep }
  | { key: string; adapter: "test"; suite: string; resultPath: string }
  | { key: string; adapter: "tofu"; kind: "plan" | "approve" | "apply" }
  | { key: string; adapter: "channel" }
  | { key: string; adapter: "operator-run"; stages: string[] };

/**
 * The ordered steps a recipe freezes, oracle test suites last (V5). Stage
 * keys are stable, so a resumed execution finds the first unsettled step.
 * A compound recipe is not executed as one deployment.
 */
export function modelSteps(recipe: ModelRecipe): ModelStep[] {
  const steps = recipeSteps(recipe);
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length)
    throw new Error("Two frozen steps share one stage key");
  return steps;
}

function recipeSteps(recipe: ModelRecipe): ModelStep[] {
  switch (recipe.kind) {
    case "kubernetes-application":
      return [
        ...recipe.steps.map((step): ModelStep => ({
          key: stepStageKey("step", step.kind),
          adapter: "kubernetes",
          step,
        })),
        ...recipe.oracle.tests.map((test): ModelStep => ({
          key: stepStageKey("test", test.suite),
          adapter: "test",
          suite: test.suite,
          resultPath: test.resultPath,
        })),
      ];
    case "tofu":
      return recipe.steps.map((step): ModelStep => ({
        key: stepStageKey("step", step.kind),
        adapter: "tofu",
        kind: step.kind,
      }));
    case "channel":
      return [{ key: stepStageKey("step", "publish"), adapter: "channel" }];
    case "operator-run":
      return [
        {
          key: stepStageKey("step", "attestation"),
          adapter: "operator-run",
          stages: recipe.stages,
        },
      ];
    case "compound":
      throw new Error(
        "A compound recipe has no single-deployment step executor yet; deploy its sub-recipes' environments",
      );
  }
}

/**
 * Intent before effect: a step whose stage succeeded is settled; the first
 * other step is where execution resumes, by readback when its intent
 * (a running stage) is already recorded.
 */
export function resumeAt(
  steps: readonly ModelStep[],
  stages: readonly { key: string; status: string }[],
): number {
  const settled = new Set(
    stages
      .filter((stage) => stage.status === "succeeded")
      .map((stage) => stage.key),
  );
  const index = steps.findIndex((step) => !settled.has(step.key));
  return index === -1 ? steps.length : index;
}

export function requireStep(steps: readonly ModelStep[], key: string) {
  const step = steps.find((entry) => entry.key === key);
  if (step === undefined)
    throw new Error(`Step ${key} is not part of the frozen recipe`);
  return step;
}
