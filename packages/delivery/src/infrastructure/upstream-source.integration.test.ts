import { createHash } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { VersionCatalogEntrySchema } from "@shepherdjerred/version-catalog";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { declareAcquisitions, registerTestService } from "#testing/services.ts";
import { replicateProducedArtifacts } from "#testing/replication.ts";
import { testPublisher } from "#testing/seed.ts";
import { AcquireUpstreamArtifactSchema } from "#shared/contract.ts";
import { sourceArchiveUri } from "#shared/artifact-contract.ts";

const context = useDeliveryFixture();
const SERVICE = "cloudflare-operator";
const NAME = "adyanth/cloudflare-operator";
const TAG = "v0.13.1";
const COMMIT = "6f2804871a3cc86cef72bc7f4ace0dd0a2aabf3f";
const TAG_URL = `https://api.github.com/repos/${NAME}/commits/${TAG}`;
const TARBALL_URL = `https://codeload.github.com/${NAME}/tar.gz/${COMMIT}`;
const tarball = new TextEncoder().encode("cloudflare-operator commit tarball");
const digest = `sha256:${createHash("sha256").update(tarball).digest("hex")}`;
const components = [
  VersionCatalogEntrySchema.parse({
    name: NAME,
    category: "upstream",
    artifactType: "source",
    management: {
      managed: true,
      datasource: "github-releases",
      versioning: "semver",
    },
    value: TAG,
    component: true,
  }),
];

beforeEach(async () => {
  await registerTestService(context.cluster.database, SERVICE);
  await declareAcquisitions(context.cluster.database, SERVICE, [
    "archive:cloudflare-operator",
  ]);
});

function acquisition(requestId: string, overrides: { digest?: string } = {}) {
  const archiveDigest = overrides.digest ?? digest;
  return AcquireUpstreamArtifactSchema.parse({
    requestId,
    serviceId: SERVICE,
    sourceRevision: "a".repeat(40),
    pipeline: { repositoryId: 1, pipelineNumber: 7 },
    artifact: {
      id: `upstream/cloudflare-operator/${COMMIT}`,
      component: "archive:cloudflare-operator",
      kind: "archive",
      uri: sourceArchiveUri(NAME, archiveDigest),
      digest: archiveDigest,
      version: COMMIT,
      origin: {
        kind: "upstream",
        repository: `https://github.com/${NAME}`,
        name: NAME,
        version: TAG,
        checksum: archiveDigest,
        commit: COMMIT,
      },
    },
  });
}

/** GitHub: the tag resolves to a commit as a bare SHA, and codeload serves that commit's tarball. */
function github(served: { commit?: string; tarball?: Uint8Array } = {}) {
  const requests: string[] = [];
  const transport = async (url: string | URL, init?: RequestInit) => {
    const href = url.toString();
    requests.push(href);
    if (href === TAG_URL) {
      expect(new Headers(init?.headers).get("accept")).toBe(
        "application/vnd.github.sha",
      );
      return new Response(served.commit ?? COMMIT);
    }
    return href === TARBALL_URL
      ? new Response(new Uint8Array(served.tarball ?? tarball))
      : new Response(null, { status: 404 });
  };
  return { requests, transport };
}

test("a tagged GitHub source is acquired as its commit's tarball, verified once replicated", async () => {
  const { requests, transport } = github();
  const first = await context.delivery.acquireUpstreamArtifact(
    acquisition("cloudflare-operator/7"),
    testPublisher,
    { transport, components },
  );
  expect(requests).toEqual([TAG_URL, TARBALL_URL]);
  // PC1: the stored tarball is a self-hosted byte, so the build waits for its replica.
  expect(first.status).toBe("pending");
  expect(first.artifact).toMatchObject({
    component: "archive:cloudflare-operator",
    kind: "archive",
    version: COMMIT,
    uri: `s3://delivery-artifacts/sources/${NAME}/${digest.slice(7)}.tar.gz`,
    origin: { version: TAG, commit: COMMIT, checksum: digest },
  });
  // The tarball's store is the registered self-hosted bucket (A6).
  await expect(
    context.cluster.database.artifact.findUniqueOrThrow({
      where: { id: first.artifact.id },
    }),
  ).resolves.toMatchObject({ store: "delivery-artifacts" });
  await replicateProducedArtifacts(context.delivery, first.buildId);
  // The next pipeline's acquisition finds the same original and verifies it.
  const next = await context.delivery.acquireUpstreamArtifact(
    acquisition("cloudflare-operator/8"),
    testPublisher,
    { transport, components },
  );
  expect(next).toMatchObject({ buildId: first.buildId, status: "verified" });
  await expect(
    context.delivery.latestQualifiedArtifact(
      {
        serviceId: SERVICE,
        component: "archive:cloudflare-operator",
        kind: "archive",
      },
      1,
    ),
  ).resolves.toMatchObject({ version: COMMIT, digest });
});

test("a tag that names another commit, or a tarball with other bytes, is refused", async () => {
  await expect(
    context.delivery.acquireUpstreamArtifact(
      acquisition("cloudflare-operator/moved-tag"),
      testPublisher,
      { transport: github({ commit: "b".repeat(40) }).transport, components },
    ),
  ).rejects.toMatchObject({
    code: "INVALID",
    message: `${NAME}@${TAG} names commit ${"b".repeat(40)}, not the acquired ${COMMIT}`,
  });
  const other = new TextEncoder().encode("rewritten archive");
  await expect(
    context.delivery.acquireUpstreamArtifact(
      acquisition("cloudflare-operator/other-bytes"),
      testPublisher,
      { transport: github({ tarball: other }).transport, components },
    ),
  ).rejects.toMatchObject({
    code: "INVALID",
    message: "The commit's tarball differs from the acquired archive digest",
  });
  expect(
    await context.cluster.database.build.count({
      where: { serviceId: SERVICE, status: "verified" },
    }),
  ).toBe(0);
});

test("a source archive is content-addressed and must be a catalog GitHub source component", async () => {
  const raw = acquisition("cloudflare-operator/elsewhere");
  expect(() =>
    AcquireUpstreamArtifactSchema.parse({
      ...raw,
      artifact: {
        ...raw.artifact,
        uri: "s3://delivery-artifacts/sources/cloudflare-operator.tar.gz",
      },
    }),
  ).toThrow(/source commit/u);
  expect(() =>
    AcquireUpstreamArtifactSchema.parse({
      ...raw,
      artifact: { ...raw.artifact, version: TAG },
    }),
  ).toThrow(/source commit/u);
  await expect(
    context.delivery.acquireUpstreamArtifact(raw, testPublisher, {
      transport: github().transport,
      components: [],
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
});
