import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import { loadCatalogDocument } from "@shepherdjerred/ops-model/delivery-catalog/files.ts";
import { publicationOwners } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { buildPublications } from "../../ci/publish-delivery.ts";
import {
  NPM_CHANNEL_PACKAGES,
  npmPackageArchiveUri,
  npmPackageArtifactId,
  npmPackageDigest,
  npmPackageTarball,
  parseNpmPackagePublications,
  registryTarballReader,
  type NpmChannelPackage,
} from "./npm-package-archive.ts";

function channelPackage(serviceId: string): NpmChannelPackage {
  const pkg = NPM_CHANNEL_PACKAGES.find(
    (entry) => entry.serviceId === serviceId,
  );
  if (pkg === undefined)
    throw new Error(`${serviceId} is no npm channel package`);
  return pkg;
}
const webring = channelPackage("webring");
const PACKED = new TextEncoder().encode("packed webring tarball");
const PUBLISHED = new TextEncoder().encode("npm's webring tarball");
const execution = { repositoryId: 1, pipelineNumber: 42 };
const pack = async () => ({
  bytes: PACKED,
  name: "webring",
  version: "1.13.0",
});

function receipt(bytes = PACKED, overrides: Record<string, unknown> = {}) {
  const digest = npmPackageDigest(bytes);
  return {
    serviceId: "webring",
    artifact: {
      id: npmPackageArtifactId(execution, webring),
      component: "archive:webring-package",
      kind: "archive",
      uri: npmPackageArchiveUri(webring, digest),
      digest,
      runtimeDigests: [],
      requires: {},
      version: "1.13.0",
      ...overrides,
    },
  };
}

describe("npm channel tarballs (X12)", () => {
  test("an unpublished version freezes the reproducible pack; a published one npm's own bytes", async () => {
    expect(
      await npmPackageTarball(webring, { pack, published: async () => null }),
    ).toEqual({ bytes: PACKED, version: "1.13.0", published: false });
    expect(
      await npmPackageTarball(webring, {
        pack,
        published: async (name, version) =>
          name === "webring" && version === "1.13.0" ? PUBLISHED : null,
      }),
    ).toEqual({ bytes: PUBLISHED, version: "1.13.0", published: true });
  });

  test("a pack of another package or a non-semver version is refused", async () => {
    await expect(
      npmPackageTarball(webring, {
        pack: async () => ({ ...(await pack()), name: "other" }),
        published: async () => null,
      }),
    ).rejects.toThrow(/not the channel's webring/u);
    await expect(
      npmPackageTarball(webring, {
        pack: async () => ({ ...(await pack()), version: "latest" }),
        published: async () => null,
      }),
    ).rejects.toThrow();
  });

  test("the registry reader returns a version's bytes only when they match npm's integrity", async () => {
    const integrity = `sha512-${createHash("sha512").update(PUBLISHED).digest("base64")}`;
    const reader = (served: Uint8Array) =>
      registryTarballReader(async (url) =>
        url === "https://registry.npmjs.org/webring"
          ? Response.json({
              versions: {
                "1.12.0": {
                  dist: {
                    integrity,
                    tarball:
                      "https://registry.npmjs.org/webring/-/webring-1.12.0.tgz",
                  },
                },
              },
            })
          : new Response(served),
      );
    expect(await reader(PUBLISHED)("webring", "1.12.0")).toEqual(PUBLISHED);
    expect(await reader(PUBLISHED)("webring", "1.13.0")).toBeNull();
    await expect(reader(PACKED)("webring", "1.12.0")).rejects.toThrow(
      /fail its own integrity/u,
    );
    expect(
      await registryTarballReader(
        async () => new Response(null, { status: 404 }),
      )("webring", "1.12.0"),
    ).toBeNull();
  });

  test("the handoff holds exactly one tarball per channel package at its digest's URI", () => {
    expect(parseNpmPackagePublications([receipt()], execution)).toHaveLength(1);
    expect(() => parseNpmPackagePublications([], execution)).toThrow(
      /exactly one archive:webring-package/u,
    );
    expect(() =>
      parseNpmPackagePublications([
        receipt(),
        { ...receipt(), serviceId: "other" },
      ]),
    ).toThrow(/unknown service other/u);
    expect(() =>
      parseNpmPackagePublications([
        receipt(PACKED, { uri: "s3://delivery-artifacts/npm/webring/x.tgz" }),
      ]),
    ).toThrow(/at its digest's URI/u);
    expect(() =>
      parseNpmPackagePublications([receipt()], {
        repositoryId: 1,
        pipelineNumber: 43,
      }),
    ).toThrow(/another CI execution/u);
  });

  test("every npm channel in the catalog has a producer, and every producer a channel", async () => {
    const document = await loadCatalogDocument();
    const channels = document.environments.flatMap((environment) => {
      const recipe = RecipeDefinitionSchema.parse(
        document.recipes.find(
          (entry) => entry.id === environment.recipeRevisionId,
        )?.definition,
      );
      return recipe.kind === "channel" && recipe.store === "npm"
        ? [
            {
              serviceId: environment.id.slice(0, environment.id.indexOf("/")),
              name: recipe.name,
              component: recipe.artifactComponent,
            },
          ]
        : [];
    });
    expect(channels).toEqual(
      NPM_CHANNEL_PACKAGES.map(({ serviceId, name, component }) => ({
        serviceId,
        name,
        component,
      })),
    );
  });
});

describe("registration of npm channel tarballs", () => {
  const ci = {
    ...execution,
    sourceRevision: "c".repeat(40),
    ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
    capturedAt: "2026-10-22T00:00:00.000Z",
    digests: {},
    charts: [],
    owners: publicationOwners("v2"),
  };
  const noReads = {
    inspectImage: async () => {
      throw new Error("unexpected image read");
    },
    chartArtifact: async () => {
      throw new Error("unexpected chart read");
    },
  };

  test("a new tarball registers under the package's service; qualified bytes are retained", async () => {
    const [fresh] = await buildPublications(
      { ...ci, packageArtifacts: [receipt()] },
      noReads,
    );
    expect(fresh).toMatchObject({
      serviceId: "webring",
      artifacts: [{ component: "archive:webring-package", version: "1.13.0" }],
      retainedArtifactIds: [],
    });
    const [retained] = await buildPublications(
      { ...ci, packageArtifacts: [receipt()] },
      {
        ...noReads,
        findQualifiedArchive: async (query) =>
          ArtifactVersionSchema.parse({
            id: "ci/1/40/npm/webring",
            buildId: "ci/1/40/webring",
            serviceId: query.serviceId,
            component: query.component,
            kind: "archive",
            uri: npmPackageArchiveUri(webring, query.digest),
            digest: query.digest,
            version: "1.13.0",
            sourceRevision: "a".repeat(40),
            createdAt: ci.capturedAt,
          }),
      },
    );
    expect(retained).toMatchObject({
      serviceId: "webring",
      artifacts: [],
      retainedArtifactIds: ["ci/1/40/npm/webring"],
    });
  });
});
