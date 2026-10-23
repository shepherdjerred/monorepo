import { expect, test } from "vitest";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "./recipe-adapter.ts";
import { RecipeDefinitionSchema } from "./recipe-contract.ts";
import { forumSourceStageKey } from "./recipe-view.ts";

async function pipeline(file: string) {
  return PipelineDefinitionSchema.parse(
    await Bun.file(
      new URL(`../../../registrations/${file}`, import.meta.url),
    ).json(),
  );
}

test("a forum release writes its candidate source at reconcile (v1) or at its Application's apply-safety step", async () => {
  const v1 = await pipeline("specialized/storm-forum/pipeline.json");
  expect(forumSourceStageKey(v1)).toBe("reconcile");
  const forum = recipeFromPipeline(v1);
  expect(forumSourceStageKey(forum)).toBe("step-apply-safety");
  // Inside a compound recipe the key carries the forum sub-recipe's position.
  const arcade = recipeFromPipeline(await pipeline("arcade.pipeline.json"));
  const compound = RecipeDefinitionSchema.parse({
    kind: "compound",
    subRecipes: [
      { instance: "application:arcade", definition: arcade },
      { instance: "application:storm-forum", definition: forum },
    ],
  });
  expect(forumSourceStageKey(compound)).toBe("sub2-step-apply-safety");
  expect(() => forumSourceStageKey(arcade)).toThrow(
    "The frozen recipe releases no forum bundle",
  );
});
