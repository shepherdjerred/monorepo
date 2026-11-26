import { describe, expect, test } from "vitest";
import { RecipeDefinitionSchema } from "./recipe-contract.ts";
import {
  siteReleaseOf,
  specializedStageKey,
  targetWithoutRemoval,
} from "./recipe-view.ts";
import {
  ARCHIVE_ALONE,
  ONE_CONTENT_TARGET,
  ONE_FORUM_BUNDLE,
  ONE_SITE_STEP,
} from "./step-order.ts";
import { applicationRecipe } from "#testing/catalog-fixture.ts";

/** An Application recipe whose third step is `extra`, if given. */
function application(name: string, extra?: Record<string, unknown>) {
  return applicationRecipe(name, extra === undefined ? [] : [extra]);
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
    const sites = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "application:scout",
          definition: application("scout", siteStep),
        },
        { instance: "application:one", definition: application("one") },
      ],
    });
    // An archive step's release deploys no other Application or static site,
    // so its compound's other member is a channel.
    const plugins = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "channel:npm/@shepherdjerred/trmnl",
          definition: {
            kind: "channel",
            store: "npm",
            name: "@shepherdjerred/trmnl",
            pointer: "latest",
            forwardOnly: false,
            artifactComponent: "archive:trmnl-package",
          },
        },
        {
          instance: "application:trmnl",
          definition: application("trmnl", archiveStep),
        },
      ],
    });
    const standaloneSiteCompound = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        { instance: "application:one", definition: application("one") },
        {
          instance: "bucket:arcade-docs",
          definition: {
            kind: "static-site",
            archiveComponent: "archive:arcade-docs",
            bucket: "arcade-docs",
            verification: {
              url: "https://arcade.sjer.red/docs",
              expectedStatus: 200,
            },
          },
        },
      ],
    });
    // The executor's keys: `sub<position>-<step key>` (lib/delivery/model/recipe.ts).
    expect(specializedStageKey(sites, "static-site")).toBe(
      "sub1-step-static-site",
    );
    expect(specializedStageKey(standaloneSiteCompound, "static-site")).toBe(
      "sub2-step-static-site",
    );
    expect(siteReleaseOf(standaloneSiteCompound)?.bucket).toBe("arcade-docs");
    expect(specializedStageKey(plugins, "archive")).toBe("sub2-step-archive");
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

/** The contract's refusal messages for a recipe definition. */
function refusal(definition: unknown) {
  return RecipeDefinitionSchema.safeParse(definition).error?.issues.map(
    (issue) => issue.message,
  );
}

describe("one site activation per release", () => {
  test("an Application recipe holds at most one static-site step", () => {
    expect(refusal(applicationRecipe("scout", [siteStep, siteStep]))).toContain(
      ONE_SITE_STEP,
    );
  });

  test("a compound recipe holds at most one static-site step across its Applications", () => {
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          {
            instance: "application:scout",
            definition: application("scout", siteStep),
          },
          {
            instance: "application:scout-preview",
            definition: application("scout-preview", siteStep),
          },
        ],
      }),
    ).toContain(ONE_SITE_STEP);
  });
});

const forumStep = {
  kind: "forum-bundle",
  pointOfNoReturn: true,
  imageComponent: "image:storm-forum",
  bundleComponent: "archive:forum-bundle",
};

/** A Forum Application recipe whose steps after its sync are `extra`. */
function forumApplication(
  name: string,
  extra: readonly Record<string, unknown>[],
) {
  return {
    ...applicationRecipe(name, extra),
    artifactParameters: {
      "delivery.image": { component: "image:storm-forum", format: "reference" },
    },
  };
}

describe("one Forum migration per release", () => {
  test("an Application recipe with one forum-bundle step is a valid Forum release", () => {
    expect(
      RecipeDefinitionSchema.safeParse(
        forumApplication("storm-forum", [forumStep]),
      ).success,
    ).toBe(true);
  });

  test("an Application recipe holds at most one forum-bundle step", () => {
    expect(
      refusal(forumApplication("storm-forum", [forumStep, forumStep])),
    ).toEqual([ONE_FORUM_BUNDLE]);
  });

  test("a compound recipe holds at most one forum-bundle step across its Applications", () => {
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          {
            instance: "application:storm-forum",
            definition: forumApplication("storm-forum", [forumStep]),
          },
          {
            instance: "application:storm-forum-staging",
            definition: forumApplication("storm-forum-staging", [forumStep]),
          },
        ],
      }),
    ).toEqual([ONE_FORUM_BUNDLE]);
  });
});

describe("one recoverable content target per release (4.15)", () => {
  test("an Application recipe does not hold both a site step and a forum-bundle step", () => {
    expect(
      refusal(forumApplication("storm-forum", [forumStep, siteStep])),
    ).toEqual([ONE_CONTENT_TARGET]);
  });

  test("a compound recipe does not hold both across its Applications or standalone site sub-recipes", () => {
    const standaloneSite = {
      kind: "static-site",
      archiveComponent: "archive:docs",
      bucket: "docs",
      verification: { url: "https://docs.sjer.red/", expectedStatus: 200 },
    };
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          {
            instance: "application:scout",
            definition: application("scout", siteStep),
          },
          {
            instance: "application:storm-forum",
            definition: forumApplication("storm-forum", [forumStep]),
          },
        ],
      }),
    ).toEqual([ONE_CONTENT_TARGET]);
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          { instance: "bucket:docs", definition: standaloneSite },
          {
            instance: "bucket:other-docs",
            definition: {
              ...standaloneSite,
              bucket: "other-docs",
              archiveComponent: "archive:other-docs",
            },
          },
        ],
      }),
    ).toEqual([ONE_SITE_STEP]);
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          { instance: "bucket:docs", definition: standaloneSite },
          {
            instance: "application:scout",
            definition: application("scout", siteStep),
          },
        ],
      }),
    ).toEqual([ONE_SITE_STEP]);
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          { instance: "bucket:docs", definition: standaloneSite },
          {
            instance: "application:storm-forum",
            definition: forumApplication("storm-forum", [forumStep]),
          },
        ],
      }),
    ).toEqual([ONE_CONTENT_TARGET]);
    expect(
      refusal({
        kind: "compound",
        subRecipes: [
          { instance: "bucket:docs", definition: standaloneSite },
          {
            instance: "application:trmnl",
            definition: application("trmnl", archiveStep),
          },
        ],
      }),
    ).toEqual([ARCHIVE_ALONE]);
  });
});

test("an Application's site or archive step keeps external state past removal, so removal waits for an adapter (4.10)", () => {
  const withSite = RecipeDefinitionSchema.parse(application("wiki", siteStep));
  const withArchive = RecipeDefinitionSchema.parse(
    application("trmnl-dashboard", archiveStep),
  );
  expect(targetWithoutRemoval(withSite)).toBe("static-site step");
  expect(targetWithoutRemoval(withArchive)).toBe("archive step");
  expect(
    targetWithoutRemoval(
      RecipeDefinitionSchema.parse({
        kind: "compound",
        subRecipes: [
          { instance: "application:arcade", definition: application("arcade") },
          {
            instance: "application:wiki",
            definition: application("wiki", siteStep),
          },
        ],
      }),
    ),
  ).toBe("static-site step");
  expect(
    targetWithoutRemoval(RecipeDefinitionSchema.parse(application("arcade"))),
  ).toBeNull();
});
