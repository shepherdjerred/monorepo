import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  RecipeDefinitionSchema,
  stepStageKey,
  subRecipeStageKey,
  type KubernetesStep,
  type RecipeDefinition,
} from "@shepherdjerred/delivery/model-contract";

/** The activation policy a static-site recipe or step freezes. */
export type StaticSiteStepPolicy = Extract<
  KubernetesStep,
  { kind: "static-site" }
>["policy"];
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

/**
 * The model recipe a deployment froze, or null for a v1 pipeline. A v1
 * static-site pipeline names its archive `site:<bucket>`, which no model
 * recipe accepts (4.3), so it keeps the v1 site adapter.
 */
export function modelRecipe(detail: DeploymentDetail): RecipeDefinition | null {
  const parsed = RecipeDefinitionSchema.safeParse(detail.pipeline.definition);
  return parsed.success ? parsed.data : null;
}

export function requireModelRecipe(detail: DeploymentDetail): RecipeDefinition {
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
  | { key: string; adapter: "channel"; phase: "publish" | "pointer" }
  | { key: string; adapter: "static-site"; policy: StaticSiteStepPolicy }
  | { key: string; adapter: "operator-run"; stages: string[] };

/**
 * The ordered steps a recipe freezes, oracle test suites last (V5). Stage
 * keys are stable, so a resumed execution finds the first unsettled step.
 * A compound recipe runs its sub-recipes' steps in recipe order under one
 * deployment, each key prefixed by its sub-recipe's position.
 */
export function modelSteps(recipe: RecipeDefinition): ModelStep[] {
  const steps = recipeSteps(recipe);
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length)
    throw new Error("Two frozen steps share one stage key");
  return steps;
}

function recipeSteps(recipe: RecipeDefinition): ModelStep[] {
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
      // Publish the version if absent, then move the pointer (section 5).
      return (["publish", "pointer"] as const).map((phase) => ({
        key: stepStageKey("step", phase),
        adapter: "channel",
        phase,
      }));
    case "static-site": {
      const { kind: _kind, ...policy } = recipe;
      return [
        {
          key: stepStageKey("step", "static-site"),
          adapter: "static-site",
          policy,
        },
      ];
    }
    case "operator-run":
      return [
        {
          key: stepStageKey("step", "attestation"),
          adapter: "operator-run",
          stages: recipe.stages,
        },
      ];
    case "compound":
      return recipe.subRecipes.flatMap((sub, index) =>
        recipeSteps(sub.definition).map((step) => ({
          ...step,
          key: subRecipeStageKey(index, step.key),
        })),
      );
  }
}

const SUB_RECIPE_KEY = /^sub(\d+)-/u;

/**
 * The recipe that owns a frozen step: a compound recipe's sub-recipe for a
 * prefixed key, otherwise the recipe itself.
 */
export function stepRecipe(
  recipe: RecipeDefinition,
  key: string,
): Exclude<RecipeDefinition, { kind: "compound" }> {
  if (recipe.kind !== "compound") return recipe;
  const position = SUB_RECIPE_KEY.exec(key)?.[1];
  const sub =
    position === undefined
      ? undefined
      : recipe.subRecipes[Number(position) - 1];
  if (sub === undefined)
    throw new Error(`Step ${key} names no sub-recipe of the compound recipe`);
  return sub.definition;
}

/** The Application steps a `retire-host` deployment runs (E5). */
const RETIREMENT_STEP_KINDS = new Set<KubernetesStep["kind"]>([
  "apply-safety",
  "sync",
  "worker-rollout",
]);

/**
 * The steps a deployment runs: every frozen step of its recipe, except that
 * a `retire-host` deployment only re-syncs the worker Application with its
 * retiring host at zero and proves it, as v1 does. It re-selects the
 * accepted set revision, so it activates no site or plugin archive and
 * migrates nothing; the Application's oracle suites still run. Each step
 * keeps its frozen stage key, so resume and recovery read the same stages.
 */
export function deploymentSteps(detail: DeploymentDetail): ModelStep[] {
  const steps = modelSteps(requireModelRecipe(detail));
  if (detail.deployment.kind !== "retire-host") return steps;
  const rollout = steps.find(
    (step) =>
      step.adapter === "kubernetes" && step.step.kind === "worker-rollout",
  );
  if (rollout === undefined)
    throw new Error("A retire-host deployment froze no worker-rollout step");
  // A compound recipe retires within the sub-recipe that owns the pool.
  const prefix = SUB_RECIPE_KEY.exec(rollout.key)?.[0] ?? "";
  return steps.filter(
    (step) =>
      step.key.startsWith(prefix) &&
      (step.adapter === "test" ||
        (step.adapter === "kubernetes" &&
          RETIREMENT_STEP_KINDS.has(step.step.kind))),
  );
}

/** The HTTP probes every Application recipe within the recipe declares (4.14). */
export function oracleProbes(
  recipe: RecipeDefinition,
): { url: string; expectedStatus: number }[] {
  switch (recipe.kind) {
    case "kubernetes-application":
      return recipe.oracle.probes;
    case "operator-run":
      // A host the operator changes by hand has only its attestations.
      return recipe.wrapped.kind === "host" ? [] : oracleProbes(recipe.wrapped);
    case "compound":
      return recipe.subRecipes.flatMap((sub) => oracleProbes(sub.definition));
    case "static-site":
    case "tofu":
    case "channel":
      return [];
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

/**
 * A step acts only after every step frozen before it settled (T3): a site,
 * plugin archive or forum release never runs against an unproven backend.
 */
export function requireSettledBefore(
  steps: readonly ModelStep[],
  stages: readonly { key: string; status: string }[],
  key: string,
) {
  const index = steps.findIndex((step) => step.key === key);
  if (index === -1)
    throw new Error(`Step ${key} is not part of the frozen recipe`);
  if (resumeAt(steps, stages) < index)
    throw new Error(
      `Step ${key} runs only after every earlier frozen step settled`,
    );
}
