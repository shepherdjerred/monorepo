import { describe, expect, test } from "vitest";
import {
  RecipeDefinitionSchema,
  subRecipeStageKey,
} from "@shepherdjerred/delivery/model-contract";
import { modelSteps, oracleProbes, resumeAt, stepRecipe } from "./recipe.ts";
import { recipe } from "./testing.ts";

/** Two Applications under one deployment: a companion, then the server. */
function compound() {
  const companion = recipe(
    { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
    "chart:arcade",
  );
  const server = {
    ...companion,
    application: { ...companion.application, name: "arcade-server" },
    steps: companion.steps.map((step) => ({
      ...step,
      instance: "application:arcade-server",
    })),
    oracle: {
      probes: [{ url: "https://arcade.sjer.red/server", expectedStatus: 200 }],
      tests: [],
    },
  };
  return RecipeDefinitionSchema.parse({
    kind: "compound",
    subRecipes: [
      { instance: "application:arcade", definition: companion },
      { instance: "application:arcade-server", definition: server },
    ],
  });
}

describe("compound recipes (T3)", () => {
  test("sub-recipe steps run in recipe order under prefixed keys", () => {
    expect(modelSteps(compound()).map((step) => step.key)).toEqual([
      "sub1-step-apply-safety",
      "sub1-step-sync",
      "sub1-test-e2e",
      "sub2-step-apply-safety",
      "sub2-step-sync",
    ]);
  });

  test("each key resolves to the sub-recipe that owns it", () => {
    const definition = compound();
    const owner = stepRecipe(definition, "sub2-step-sync");
    expect(
      owner.kind === "kubernetes-application" && owner.application.name,
    ).toBe("arcade-server");
    expect(() => stepRecipe(definition, "sub3-step-sync")).toThrow(
      /names no sub-recipe/u,
    );
    expect(() => stepRecipe(definition, "step-sync")).toThrow(
      /names no sub-recipe/u,
    );
    const single = recipe(
      { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
      "chart:arcade",
    );
    const parsed = RecipeDefinitionSchema.parse(single);
    expect(stepRecipe(parsed, "step-sync")).toBe(parsed);
  });

  test("a resumed compound deployment starts at its first unsettled sub-step", () => {
    const steps = modelSteps(compound());
    expect(
      resumeAt(steps, [
        { key: "sub1-step-apply-safety", status: "succeeded" },
        { key: "sub1-step-sync", status: "succeeded" },
        { key: "sub1-test-e2e", status: "succeeded" },
        { key: "sub2-step-apply-safety", status: "running" },
      ]),
    ).toBe(3);
  });

  test("acceptance probes every Application the compound recipe deploys", () => {
    expect(oracleProbes(compound()).map((probe) => probe.url)).toEqual([
      "https://arcade.sjer.red/health",
      "https://arcade.sjer.red/server",
    ]);
  });

  test("a prefixed key must still be a Job stage key", () => {
    expect(subRecipeStageKey(0, "step-sync")).toBe("sub1-step-sync");
    expect(() => subRecipeStageKey(0, `test-${"x".repeat(60)}`)).toThrow(
      /not a stage key/u,
    );
  });
});
