import { describe, expect, test } from "vitest";
import { VersionSetRevisionSchema } from "#shared/contract.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { applicationRecipe } from "#testing/catalog-fixture.ts";
import { validateTrmnlSelection } from "./trmnl-policy.ts";

function application(name: string, archive: boolean) {
  return applicationRecipe(
    name,
    archive
      ? [{ kind: "archive", archiveComponent: "archive:trmnl-plugins" }]
      : [],
  );
}

/** The dashboard's selection with its first-party plugin archive. */
const selected = VersionSetRevisionSchema.parse({
  id: "trmnl-dashboard/set",
  serviceId: "trmnl-dashboard",
  revision: 1,
  baseRevisionId: null,
  lineage: "0".repeat(64),
  orderKey: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  components: {
    "archive:trmnl-plugins": {
      id: "archive/trmnl-plugins",
      component: "archive:trmnl-plugins",
      kind: "archive",
      uri: `s3://delivery-artifacts/trmnl/${"a".repeat(64)}.json`,
      digest: `sha256:${"a".repeat(64)}`,
      version: "1",
      serviceId: "trmnl-dashboard",
      buildId: "build/1",
      sourceRevision: "a".repeat(40),
      createdAt: "2026-10-23T00:00:00.000Z",
    },
  },
});

describe("TRMNL plugin selection (T3)", () => {
  test("a compound recipe is checked through the Application that owns the archive step", () => {
    const compound = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "application:scout",
          definition: application("scout", false),
        },
        {
          instance: "application:trmnl-dashboard",
          definition: application("trmnl-dashboard", true),
        },
      ],
    });
    expect(() => validateTrmnlSelection(compound, selected)).not.toThrow();
  });

  test("an archive step owned by another Application is refused", () => {
    const misplaced = RecipeDefinitionSchema.parse(application("scout", true));
    expect(() => validateTrmnlSelection(misplaced, selected)).toThrow(
      /fixed dashboard/u,
    );
  });

  test("a second archive step after the dashboard's is refused", () => {
    // The dashboard's step is first, so a first-occurrence check would admit it.
    const compound = RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "application:trmnl-dashboard",
          definition: application("trmnl-dashboard", true),
        },
        {
          instance: "application:scout",
          definition: application("scout", true),
        },
      ],
    });
    expect(() => validateTrmnlSelection(compound, selected)).toThrow(
      /exactly one archive step/u,
    );
  });
});
