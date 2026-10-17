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
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
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

function releaseState(build: number, source: string, backend: string) {
  return parseScoutReleaseState(
    JSON.stringify({
      schema: "scout-release-state/v1",
      buildNumber: build,
      version: `2.0.0-${String(build)}`,
      sourceCommit: source,
      backendImageDigest: backend,
      siteArchiveDigest: imageA,
      betaSiteArchiveDigest: imageA,
      releaseInputDigest: imageA,
    }),
  );
}

async function publication(
  build: number,
  source: string,
  digests: Record<string, string>,
  backend: unknown,
) {
  const requirements = scoutArchiveRequirements(
    releaseState(build, source, scoutDeliveryBackendDigest(backend)),
    backend,
    { sourceRevision: source, repositoryId: 1, pipelineNumber: build },
  );
  const [result] = await buildPublications(
    {
      digests,
      charts: undefined,
      sourceRevision: source,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(build)}`,
      repositoryId: 1,
      pipelineNumber: build,
      capturedAt: new Date().toISOString(),
      siteArtifacts: ["scout-frontend-beta", "scout-frontend"].map(
        (bucket) => ({
          serviceId: "scout-for-lol",
          artifact: {
            id: `ci/1/${String(build)}/site/${bucket}`,
            component: `site:${bucket}`,
            kind: "archive",
            uri: `s3://delivery-artifacts/sites/${bucket}/${"a".repeat(64)}.tar`,
            digest: imageA,
            version: `build-${String(build)}`,
            requires: requirements,
          },
        }),
      ),
    },
    {
      inspectImage: async () => manifest,
      chartArtifact: async () => {
        throw new Error("Unexpected chart");
      },
    },
  );
  if (result === undefined) throw new Error("Missing Scout publication");
  return result;
}

async function qualify(build: number, input: PublishBuild) {
  const registered = await delivery.publish(input, testPublisher, {
    repositoryId: 1,
    pipelineNumber: build,
  });
  expect(
    await delivery.qualify(registered.buildId, "verified", testExecutor),
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
