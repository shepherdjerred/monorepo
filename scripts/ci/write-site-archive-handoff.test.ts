import { describe, expect, test } from "vitest";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { buildPublications } from "./publish-delivery.ts";
import { siteArchivePublications } from "./write-site-archive-handoff.ts";

const digest = `sha256:${"a".repeat(64)}`;
function siteArchive(bucket: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `ci/1/42/site/${bucket}`,
    component: `site:${bucket}`,
    kind: "archive",
    uri: `s3://delivery-artifacts/sites/${bucket}/${"a".repeat(64)}.tar`,
    digest,
    version: "build-42",
    ...overrides,
  };
}
const scout = [
  {
    serviceId: "scout-for-lol",
    artifact: siteArchive("scout-frontend", {
      requires: { "image:scout-for-lol": digest },
    }),
  },
];
const catalog = publicationOwners("v2");
/** The catalog document as it would read without the sjer.red site service. */
const withoutSjerRed = publicationOwners("v2", {
  core: {
    ...CATALOG_CORE,
    services: CATALOG_CORE.services.filter(
      (service) => service.id !== "sjer-red",
    ),
  },
});

describe("v1 static site handoff, before the window's catalog flip", () => {
  test("registers every independent archive under static-sites, as v1 does", () => {
    const publications = siteArchivePublications(
      [...scout, { ...scout[0], serviceId: "static-sites" }],
      [siteArchive("sjer-red"), siteArchive("not-in-the-catalog")],
    );
    expect(publications.map((entry) => entry.serviceId)).toEqual([
      "scout-for-lol",
      "static-sites",
      "static-sites",
      "static-sites",
    ]);
  });
});

describe("static site handoff ownership", () => {
  test("stamps each independent archive with its own bucket-named service and keeps Scout's owner", () => {
    const publications = siteArchivePublications(
      scout,
      [siteArchive("sjer-red"), siteArchive("resume")],
      catalog,
    );
    expect(
      publications.map((entry) => [entry.serviceId, entry.artifact.component]),
    ).toEqual([
      ["scout-for-lol", "site:scout-frontend"],
      ["sjer-red", "site:sjer-red"],
      ["resume", "site:resume"],
    ]);
    expect(publications[0]?.artifact.requires).toEqual({
      "image:scout-for-lol": digest,
    });
  });

  test("a bucket without a catalog service, a non-site archive, or a foreign Scout owner fails in the producing step", () => {
    expect(() =>
      siteArchivePublications(scout, [siteArchive("sjer-red")], withoutSjerRed),
    ).toThrow("requires a service catalog owner sjer-red");
    expect(() =>
      siteArchivePublications(
        [],
        [siteArchive("trmnl", { component: "archive:trmnl-plugins" })],
        catalog,
      ),
    ).toThrow("requires a site archive");
    expect(() =>
      siteArchivePublications(
        [{ ...scout[0], serviceId: "scout-frontend" }],
        [],
        catalog,
      ),
    ).toThrow();
  });

  test("registration accepts the stamped owners and groups one build per site service", async () => {
    const siteArtifacts = siteArchivePublications(
      scout,
      [siteArchive("sjer-red"), siteArchive("resume")],
      catalog,
    );
    const builds = await buildPublications(
      {
        digests: {},
        charts: undefined,
        siteArtifacts,
        sourceRevision: "c".repeat(40),
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
        pipelineNumber: 42,
        repositoryId: 1,
        capturedAt: "2026-10-17T10:00:00.000Z",
        owners: catalog,
      },
      {
        inspectImage: () => {
          throw new Error("No image was produced");
        },
        chartArtifact: () => {
          throw new Error("No chart was produced");
        },
      },
    );
    expect(
      builds.map((build) => [
        build.serviceId,
        build.artifacts.map((artifact) => artifact.component),
      ]),
    ).toEqual([
      ["scout-for-lol", ["site:scout-frontend"]],
      ["sjer-red", ["site:sjer-red"]],
      ["resume", ["site:resume"]],
    ]);
    await expect(
      buildPublications(
        {
          digests: {},
          charts: undefined,
          siteArtifacts,
          sourceRevision: "c".repeat(40),
          ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
          pipelineNumber: 42,
          repositoryId: 1,
          capturedAt: "2026-10-17T10:00:00.000Z",
          owners: withoutSjerRed,
        },
        {
          inspectImage: () => {
            throw new Error("No image was produced");
          },
          chartArtifact: () => {
            throw new Error("No chart was produced");
          },
        },
      ),
    ).rejects.toThrow("unknown service sjer-red");
  });
});
