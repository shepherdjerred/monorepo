import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  createApp,
  createTestDatabase,
  Delivery,
  testExecutor,
  testPublisher,
  testOperator,
} from "@shepherdjerred/delivery/testing";
import type {
  ArtifactVersion,
  FindQualifiedArtifact,
  PublishBuild,
} from "@shepherdjerred/delivery/contract";
import { buildPublications } from "../ci/publish-delivery.ts";
import {
  resolveScoutDeliveryBackend,
  scoutArchiveRequirements,
  scoutDeliveryBackendDigest,
} from "../lib/scout/scout-delivery-backend.ts";
import { parseScoutReleaseState } from "../lib/scout/scout-release-state.ts";

const imageA = `sha256:${"a".repeat(64)}`;
const manifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { digest: imageA },
  layers: [],
});
const imageB = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
const sourceB = "b".repeat(40);
const sourceC = "c".repeat(40);
let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;

beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

function releaseState(
  build: number,
  source: string,
  backend: string,
  archive = imageA,
) {
  return parseScoutReleaseState(
    JSON.stringify({
      schema: "scout-release-state/v1",
      buildNumber: build,
      version: `2.0.0-${String(build)}`,
      sourceCommit: source,
      backendImageDigest: backend,
      siteArchiveDigest: archive,
      betaSiteArchiveDigest: archive,
      releaseInputDigest: archive,
    }),
  );
}

/**
 * Site bytes per content generation. Different generations are different
 * bytes; the same generation rebuilt on a later commit is byte-identical, which
 * is what B2 retains and R2 declines to re-compose.
 */
function siteDigest(content: number) {
  return `sha256:${createHash("sha256")
    .update(`scout-site-${String(content)}`)
    .digest("hex")}`;
}

const dependencies = {
  inspectImage: async () => manifest,
  chartArtifact: async () => {
    throw new Error("Unexpected chart");
  },
};

/**
 * One CI pipeline's Scout handoffs: both site archives built from `content`
 * (its own build number unless stated) against a frozen backend.
 */
function publicationInput(
  pipeline: { build: number; source: string; content?: number },
  digests: Record<string, string>,
  backend: unknown,
) {
  const { build, source } = pipeline;
  const archive = siteDigest(pipeline.content ?? build);
  const requirements = scoutArchiveRequirements(
    releaseState(build, source, scoutDeliveryBackendDigest(backend), archive),
    backend,
    { sourceRevision: source, repositoryId: 1, pipelineNumber: build },
  );
  return {
    digests,
    charts: undefined,
    sourceRevision: source,
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(build)}`,
    repositoryId: 1,
    pipelineNumber: build,
    capturedAt: new Date().toISOString(),
    siteArtifacts: ["scout-frontend-beta", "scout-frontend"].map((bucket) => ({
      serviceId: "scout-for-lol",
      artifact: {
        id: `ci/1/${String(build)}/site/${bucket}`,
        component: `site:${bucket}`,
        kind: "archive",
        uri: `s3://delivery-artifacts/sites/${bucket}/${archive.slice(7)}.tar`,
        digest: archive,
        version: `build-${String(build)}`,
        requires: requirements,
      },
    })),
  };
}

async function publication(
  build: number,
  source: string,
  digests: Record<string, string>,
  backend: unknown,
) {
  const [result] = await buildPublications(
    publicationInput({ build, source }, digests, backend),
    dependencies,
  );
  if (result === undefined) throw new Error("Missing Scout publication");
  return result;
}

/** In-process stand-in for the client's 404: a missing original is "no retention". */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && error.code === "NOT_FOUND"
  );
}

async function qualify(build: number, input: PublishBuild, store = delivery) {
  const registered = await store.publish(input, testPublisher, {
    repositoryId: 1,
    pipelineNumber: build,
  });
  expect(
    await store.qualify(registered.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  return registered;
}

test("fresh runtime-equivalent imageB and later site-onlyC retain genuine image provenance", async () => {
  const baseline = await resolveScoutDeliveryBackend(
    {
      digests: { "shepherdjerred/scout-for-lol": imageA },
      sourceRevision: "a".repeat(40),
      repositoryId: 1,
      pipelineNumber: 1,
    },
    async () => {
      throw new Error("Fresh image must not read PG");
    },
  );
  const initial = await publication(1, "a".repeat(40), {}, baseline);
  initial.artifacts.unshift({
    id: "ci/1/1/image/scout-for-lol",
    component: "image:scout-for-lol",
    kind: "image",
    uri: "docker.io/shepherdjerred/scout-for-lol",
    digest: imageA,
    runtimeDigests: [],
    requires: {},
    version: "build-1",
  });
  await qualify(1, initial);
  const fresh = await resolveScoutDeliveryBackend(
    {
      digests: { "shepherdjerred/scout-for-lol": imageB },
      sourceRevision: sourceB,
      repositoryId: 1,
      pipelineNumber: 2,
    },
    async () => {
      throw new Error("Fresh image must not read PG");
    },
  );
  const built = await qualify(
    2,
    await publication(
      2,
      sourceB,
      { "shepherdjerred/scout-for-lol": imageB },
      fresh,
    ),
  );
  await delivery.compose(
    {
      requestId: "manual-older-image",
      serviceId: "scout-for-lol",
      components: { "image:scout-for-lol": "ci/1/1/image/scout-for-lol" },
    },
    testOperator,
  );
  const app = createApp({
    delivery,
    peerAddress: () => "127.0.0.1",
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "pending",
    config: {
      publicOrigin: "http://localhost",
      machineCredentials: [
        { token: "fixture-publisher", principal: testPublisher },
      ],
      writesEnabled: async () => false,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
    },
  });
  const client = createDeliveryClient({
    baseUrl: "http://localhost",
    headers: { Authorization: "Bearer fixture-publisher" },
    fetch: async (input, init) =>
      await app.request(
        new Request(input instanceof Request ? input.url : String(input), init),
      ),
  });
  const reused = await resolveScoutDeliveryBackend(
    {
      digests: {},
      sourceRevision: sourceC,
      repositoryId: 1,
      pipelineNumber: 3,
    },
    client.latestQualifiedArtifact,
  );
  expect(reused).toMatchObject({
    provenance: "qualified-artifact",
    artifact: {
      id: "ci/1/2/image/scout-for-lol",
      buildId: built.buildId,
      sourceRevision: sourceB,
      digest: imageB,
    },
  });
  const siteOnly = await publication(3, sourceC, {}, reused);
  expect(siteOnly.artifacts.map((artifact) => artifact.kind)).toEqual([
    "archive",
    "archive",
  ]);
  await qualify(3, siteOnly);
  const [selected] = await delivery.versions("scout-for-lol");
  expect(selected?.components["image:scout-for-lol"]).toMatchObject({
    id: "ci/1/2/image/scout-for-lol",
    buildId: built.buildId,
    sourceRevision: sourceB,
    digest: imageB,
  });
  expect(selected?.components["site:scout-frontend"]).toMatchObject({
    sourceRevision: sourceC,
    requires: { "image:scout-for-lol": imageB },
  });
  expect(() =>
    scoutArchiveRequirements(releaseState(3, sourceC, imageA), reused, {
      sourceRevision: sourceC,
      repositoryId: 1,
      pipelineNumber: 3,
    }),
  ).toThrow("frozen backend artifact");
}, 60_000);

test("late image build cannot replace the backend of a newer coherent site release", async () => {
  const isolated = await createTestDatabase();
  try {
    const store = new Delivery(isolated.database);
    const sourceA = "a".repeat(40);
    const sourceD = "d".repeat(40);
    const fresh = async (build: number, source: string, digest: string) =>
      await resolveScoutDeliveryBackend(
        {
          digests: { "shepherdjerred/scout-for-lol": digest },
          sourceRevision: source,
          repositoryId: 1,
          pipelineNumber: build,
        },
        async () => {
          throw new Error("Fresh candidate must not read prior releases");
        },
      );
    const latest = (query: {
      serviceId: string;
      component: string;
      kind: "image";
    }) => store.latestQualifiedArtifact(query, 1);
    const initial = await publication(
      1,
      sourceA,
      {},
      await fresh(1, sourceA, imageA),
    );
    initial.artifacts.unshift({
      id: "ci/1/1/image/scout-for-lol",
      component: "image:scout-for-lol",
      kind: "image",
      uri: "docker.io/shepherdjerred/scout-for-lol",
      digest: imageA,
      runtimeDigests: [],
      requires: {},
      version: "build-1",
    });
    const build1 = await qualify(1, initial, store);
    const backend3 = await resolveScoutDeliveryBackend(
      {
        digests: {},
        sourceRevision: sourceC,
        repositoryId: 1,
        pipelineNumber: 3,
      },
      latest,
    );
    await qualify(3, await publication(3, sourceC, {}, backend3), store);
    const build2 = await qualify(
      2,
      await publication(
        2,
        sourceB,
        { "shepherdjerred/scout-for-lol": imageB },
        await fresh(2, sourceB, imageB),
      ),
      store,
    );
    expect(
      await isolated.database.versionSet.count({
        where: { qualifiedBuildId: build2.buildId },
      }),
    ).toBe(0);

    const backend4 = await resolveScoutDeliveryBackend(
      {
        digests: {},
        sourceRevision: sourceD,
        repositoryId: 1,
        pipelineNumber: 4,
      },
      latest,
    );
    expect(backend4).toMatchObject({
      provenance: "qualified-artifact",
      artifact: {
        id: "ci/1/1/image/scout-for-lol",
        buildId: build1.buildId,
        sourceRevision: sourceA,
        digest: imageA,
      },
    });
    const input4 = await publication(4, sourceD, {}, backend4);
    expect(input4.artifacts.map((artifact) => artifact.kind)).toEqual([
      "archive",
      "archive",
    ]);
    await qualify(4, input4, store);
    const [selected] = await store.versions("scout-for-lol");
    expect(selected?.components["image:scout-for-lol"]).toMatchObject({
      id: "ci/1/1/image/scout-for-lol",
      buildId: build1.buildId,
      sourceRevision: sourceA,
      digest: imageA,
    });
    expect(selected?.components["site:scout-frontend"]).toMatchObject({
      sourceRevision: sourceD,
      requires: { "image:scout-for-lol": imageA },
    });
  } finally {
    await isolated.close();
  }
}, 60_000);

test("rebuilding unchanged site bytes on a later commit retains the qualified archives and creates no set revision", async () => {
  const isolated = await createTestDatabase();
  try {
    const store = new Delivery(isolated.database);
    const sourceA = "a".repeat(40);
    const revisions = () =>
      isolated.database.versionSet.count({
        where: { serviceId: "scout-for-lol" },
      });
    // Pipeline 1 builds the image and both site archives from sourceA.
    const initial = await publication(
      1,
      sourceA,
      {},
      await resolveScoutDeliveryBackend(
        {
          digests: { "shepherdjerred/scout-for-lol": imageA },
          sourceRevision: sourceA,
          repositoryId: 1,
          pipelineNumber: 1,
        },
        async () => {
          throw new Error("Fresh image must not read PG");
        },
      ),
    );
    initial.artifacts.unshift({
      id: "ci/1/1/image/scout-for-lol",
      component: "image:scout-for-lol",
      kind: "image",
      uri: "docker.io/shepherdjerred/scout-for-lol",
      digest: imageA,
      runtimeDigests: [],
      requires: {},
      version: "build-1",
    });
    const build1 = await qualify(1, initial, store);
    expect(await revisions()).toBe(1);

    // Pipeline 2 (sourceB) reuses the qualified image by reference and rebuilds
    // the sites to byte-identical archives with the same requirement.
    const reused = await resolveScoutDeliveryBackend(
      {
        digests: {},
        sourceRevision: sourceB,
        repositoryId: 1,
        pipelineNumber: 2,
      },
      (query) => store.latestQualifiedArtifact(query, 1),
    );
    expect(reused).toMatchObject({
      provenance: "qualified-artifact",
      artifact: { id: "ci/1/1/image/scout-for-lol", digest: imageA },
    });
    const lookups: FindQualifiedArtifact[] = [];
    const findQualifiedArchive = async (
      query: FindQualifiedArtifact,
    ): Promise<ArtifactVersion | undefined> => {
      lookups.push(query);
      try {
        return await store.findQualifiedArtifact(query, 1);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    };
    const [rebuilt] = await buildPublications(
      publicationInput({ build: 2, source: sourceB, content: 1 }, {}, reused),
      { ...dependencies, findQualifiedArchive },
    );
    if (rebuilt === undefined) throw new Error("Missing Scout publication");
    expect(
      lookups
        .map((query) => query.component)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["site:scout-frontend", "site:scout-frontend-beta"]);
    for (const query of lookups)
      expect(query).toMatchObject({
        serviceId: "scout-for-lol",
        kind: "archive",
        digest: siteDigest(1),
        originKind: "first-party",
      });
    expect(lookups.every((query) => query.version === undefined)).toBe(true);
    // Nothing new is registered: both archives are retained by reference.
    expect(rebuilt.artifacts).toEqual([]);
    expect(rebuilt.retainedArtifactIds).toHaveLength(2);
    expect(rebuilt.retainedArtifactIds).toEqual(
      expect.arrayContaining([
        "ci/1/1/site/scout-frontend-beta",
        "ci/1/1/site/scout-frontend",
      ]),
    );
    expect(rebuilt.sourceRevision).toBe(sourceB);

    const build2 = await qualify(2, rebuilt, store);
    expect(build2.buildId).not.toBe(build1.buildId);
    // The verified build selects exactly the base set's artifacts, so no set
    // revision is composed and the selected components keep their provenance.
    expect(await revisions()).toBe(1);
    expect(
      await isolated.database.versionSet.findFirstOrThrow({
        where: { serviceId: "scout-for-lol" },
      }),
    ).toMatchObject({ revision: 1, qualifiedBuildId: build1.buildId });
    const [selected] = await store.versions("scout-for-lol");
    expect(selected?.revision).toBe(1);
    for (const bucket of ["scout-frontend-beta", "scout-frontend"])
      expect(selected?.components[`site:${bucket}`]).toMatchObject({
        id: `ci/1/1/site/${bucket}`,
        buildId: build1.buildId,
        sourceRevision: sourceA,
        digest: siteDigest(1),
        requires: { "image:scout-for-lol": imageA },
      });
  } finally {
    await isolated.close();
  }
}, 60_000);

test("site-only publication fails closed without a qualified image", async () => {
  await expect(
    resolveScoutDeliveryBackend(
      {
        digests: {},
        sourceRevision: sourceC,
        repositoryId: 1,
        pipelineNumber: 4,
      },
      async () => {
        throw new Error("No qualified image");
      },
    ),
  ).rejects.toThrow("No qualified image");
});

test("current-build archive receipts cannot cross repository or pipeline boundaries", async () => {
  const selected = await resolveScoutDeliveryBackend(
    {
      digests: { "shepherdjerred/scout-for-lol": imageB },
      sourceRevision: sourceB,
      repositoryId: 1,
      pipelineNumber: 2,
    },
    async () => {
      throw new Error("Unexpected PG read");
    },
  );
  for (const current of [
    { sourceRevision: sourceB, repositoryId: 2, pipelineNumber: 2 },
    { sourceRevision: sourceB, repositoryId: 1, pipelineNumber: 3 },
  ])
    expect(() =>
      scoutArchiveRequirements(
        releaseState(2, sourceB, imageB),
        selected,
        current,
      ),
    ).toThrow("producing CI build");
});
