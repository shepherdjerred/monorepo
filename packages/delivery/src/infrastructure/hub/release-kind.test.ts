import { describe, expect, it } from "vitest";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import { releaseKindOf } from "#shared/deployment-request-contract.ts";
import { recipeKindOf } from "#shared/model/recipe-view.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { requireKindForRecipe } from "#infrastructure/selection/selection.ts";
import {
  arcadeCompoundRecipe,
  arcadePipeline,
} from "#testing/model-fixture.ts";

const GENERIC = ["deploy", "channel-publish", "operator-run"] as const;

function revision(definition: unknown) {
  return PipelineRevisionSchema.parse({
    id: "arcade/recipe",
    definition,
    createdAt: "2026-10-16T00:00:00.000Z",
  });
}

const manual = revision({ kind: "manual", reason: "v1 group deploys" });
const stored = [
  manual,
  revision(arcadePipeline),
  revision(recipeFromPipeline(arcadePipeline)),
  revision(arcadeCompoundRecipe()),
  revision({
    kind: "channel",
    store: "docker-hub",
    name: "shepherdjerred/arcade",
    pointer: "latest",
    forwardOnly: false,
    artifactComponent: "image:arcade",
  }),
  revision({
    kind: "operator-run",
    wrapped: {
      kind: "host",
      instance: "host:arcade",
      components: ["image:arcade"],
    },
    stages: ["upgrade"],
  }),
];

describe("release kind", () => {
  it.each(stored.map((pipeline) => [pipeline.definition.kind, pipeline]))(
    "the release kind of a stored %s recipe is the one kind admission accepts",
    (_kind, pipeline) => {
      const kind = releaseKindOf(pipeline.definition.kind);
      expect(() => {
        requireKindForRecipe(kind, pipeline);
      }).not.toThrow();
      for (const other of GENERIC.filter((entry) => entry !== kind))
        expect(() => {
          requireKindForRecipe(other, pipeline);
        }).toThrow("is realised by");
    },
  );

  it("deploys a v1 manual pipeline, which its normalised recipe kind would run", () => {
    expect(releaseKindOf(manual.definition.kind)).toBe("deploy");
    const normalised = releaseKindOf(recipeKindOf(manual.definition));
    expect(normalised).toBe("operator-run");
    expect(() => {
      requireKindForRecipe(normalised, manual);
    }).toThrow("A manual recipe is realised by deploy, not operator-run");
  });
});
