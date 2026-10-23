import { describe, expect, test } from "vitest";
import { RecipeDefinitionSchema } from "./recipe-contract.ts";
import { specializedStageKey } from "./recipe-view.ts";

/** An Application recipe whose third step is `extra`, if given. */
function application(name: string, extra?: Record<string, unknown>) {
  const instance = `application:${name}`;
  return {
    kind: "kubernetes-application",
    application: {
      name,
      project: "default",
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: name,
      },
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: name,
      },
      lifecycle: "retain",
    },
    chartComponent: `chart:${name}`,
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance },
      { kind: "sync", instance },
      ...(extra === undefined ? [] : [{ instance, ...extra }]),
    ],
    oracle: {},
  };
}

const archiveStep = {
  kind: "archive",
  archiveComponent: "archive:trmnl-plugins",
};
const siteStep = {
  kind: "static-site",
  instance: "bucket:scout-frontend",
  policy: {
    archiveComponent: "archive:scout-frontend",
    bucket: "scout-frontend",
    immutablePrefixes: [],
    extraExcludes: [],
    entrypoints: ["index.html"],
    verification: { url: "https://scout-for-lol.com/", expectedStatus: 200 },
  },
};

describe("specializedStageKey (T3)", () => {
  test("a single recipe settles under the step's own key", () => {
    const recipe = RecipeDefinitionSchema.parse(
      application("trmnl", archiveStep),
    );
    expect(specializedStageKey(recipe, "archive")).toBe("step-archive");
  });

  test("a compound recipe's step settles under its sub-recipe's prefixed key", () => {
    const compound = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "application:scout",
          definition: application("scout", siteStep),
        },
        {
          instance: "application:trmnl",
          definition: application("trmnl", archiveStep),
        },
      ],
    });
    // The executor's keys: `sub<position>-<step key>` (lib/delivery/model/recipe.ts).
    expect(specializedStageKey(compound, "static-site")).toBe(
      "sub1-step-static-site",
    );
    expect(specializedStageKey(compound, "archive")).toBe("sub2-step-archive");
  });

  test("a compound recipe without the step names none", () => {
    const compound = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        { instance: "application:one", definition: application("one") },
        { instance: "application:two", definition: application("two") },
      ],
    });
    expect(() => specializedStageKey(compound, "archive")).toThrow(
      /has no archive step/u,
    );
  });
});
