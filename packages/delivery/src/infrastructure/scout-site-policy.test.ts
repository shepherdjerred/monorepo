import { describe, expect, test } from "vitest";
import { VersionSetRevisionSchema } from "#shared/contract.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { validateScoutSiteSelection } from "./scout-site-policy.ts";

/** One service's selection holding only its own site archive. */
function siteSelection(serviceId: string, site: string) {
  return VersionSetRevisionSchema.parse({
    id: `${serviceId}/set`,
    serviceId,
    revision: 1,
    baseRevisionId: null,
    lineage: "0".repeat(64),
    orderKey: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    components: {
      [`archive:${site}`]: {
        id: `archive/${site}`,
        component: `archive:${site}`,
        kind: "archive",
        uri: `s3://delivery-artifacts/sites/${site}/${"a".repeat(64)}.tar`,
        digest: `sha256:${"a".repeat(64)}`,
        version: "1",
        serviceId,
        buildId: "build/1",
        sourceRevision: "a".repeat(40),
        createdAt: "2026-10-23T00:00:00.000Z",
      },
    },
  });
}

/** A standalone site recipe, as the catalog declares an ordinary site. */
function siteRecipe(site: string) {
  return RecipeDefinitionSchema.parse({
    kind: "static-site",
    archiveComponent: `archive:${site}`,
    bucket: site,
    verification: { url: `https://${site}.example/`, expectedStatus: 200 },
  });
}

describe("Scout site selection", () => {
  test("an ordinary standalone site needs no Scout backend image", () => {
    expect(() =>
      validateScoutSiteSelection(
        siteRecipe("sjer-red"),
        siteSelection("sjer-red", "sjer-red"),
      ),
    ).not.toThrow();
  });

  test("Scout's frontend never activates as a standalone site", () => {
    expect(() =>
      validateScoutSiteSelection(
        siteRecipe("scout-frontend"),
        siteSelection("scout-for-lol", "scout-frontend"),
      ),
    ).toThrow(/combined backend release lock/u);
  });
});
