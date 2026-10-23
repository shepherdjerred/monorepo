import { describe, expect, test } from "vitest";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { buildPublications } from "./publish-delivery.ts";
import { siteArchivePublications } from "./write-site-archive-handoff.ts";

const digest = `sha256:${"a".repeat(64)}`;
function siteArchive(bucket: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `ci/1/42/site/${bucket}`,
    component: `archive:${bucket}`,
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
/** What a producer writes while the catalog flag is off. */
function v1SiteArchive(bucket: string) {
  return siteArchive(bucket, { component: `site:${bucket}` });
}
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
  test("registers every independent archive under static-sites with its v1 site component", () => {
    const v1Scout = {
      serviceId: "scout-for-lol",
      artifact: v1SiteArchive("scout-frontend"),
    };
    const publications = siteArchivePublications(
      [v1Scout, { ...v1Scout, serviceId: "static-sites" }],
      [v1SiteArchive("sjer-red"), v1SiteArchive("not-in-the-catalog")],
    );
    expect(
      publications.map((entry) => [entry.serviceId, entry.artifact.component]),
    ).toEqual([
      ["scout-for-lol", "site:scout-frontend"],
      ["static-sites", "site:scout-frontend"],
      ["static-sites", "site:sjer-red"],
      ["static-sites", "site:not-in-the-catalog"],
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
      ["scout-for-lol", "archive:scout-frontend"],
      ["sjer-red", "archive:sjer-red"],
      ["resume", "archive:resume"],
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
    // A producer still naming v1 components cannot compose a v2 set.
    expect(() =>
      siteArchivePublications(scout, [v1SiteArchive("sjer-red")], catalog),
    ).toThrow("requires a site archive, not site:sjer-red");
    expect(() =>
      siteArchivePublications(
        [{ ...scout[0], artifact: v1SiteArchive("scout-frontend") }],
        [],
        catalog,
      ),
    ).toThrow("Scout's site handoff requires a site archive");
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
      ["scout-for-lol", ["archive:scout-frontend"]],
      ["sjer-red", ["archive:sjer-red"]],
      ["resume", ["archive:resume"]],
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
