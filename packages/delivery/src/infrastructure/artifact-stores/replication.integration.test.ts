import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { createTestDatabase } from "#testing/postgres.ts";
import { testExecutor, testPublisher } from "#testing/seed.ts";
import { testPublication } from "#testing/delivery-fixture.ts";
import { testReplication } from "#testing/replication.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { Delivery } from "#infrastructure/delivery.ts";

const executorToken = "replication-executor-test-credential";
const publisherToken = "replication-publisher-test-credential";
let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
  app = createApp({
    delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    peerAddress: () => "127.0.0.1",
    config: {
      publicOrigin: "http://delivery.test",
      machineCredentials: [
        { token: executorToken, principal: testExecutor },
        { token: publisherToken, principal: testPublisher },
      ],
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
      trustedProxyAddresses: async () => [],
      operatorLogins: async () => [],
    },
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
  );
});
function client(token = executorToken) {
  return createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: `Bearer ${token}` },
    fetch: async (input, init) => app.request(input, init),
  });
}
const digestOf = (number: number) =>
  `sha256:${number.toString(16).padStart(64, "0")}`;
const archiveUri = (number: number) =>
  `s3://delivery-artifacts/sites/sjer-red/${digestOf(number).slice(7)}.tar`;
async function publishSite(
  number: number,
  options: {
    archive?: boolean;
    image?: boolean;
    retainedArtifactIds?: string[];
  } = {},
) {
  const { archive = true, image = false, retainedArtifactIds = [] } = options;
  return delivery.publish(
    {
      requestId: `site/${String(number)}`,
      serviceId: "static-sites",
      sourceRevision: number.toString(16).padStart(40, "0"),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        ...(archive
          ? [
              {
                id: `site/archive/${String(number)}`,
                component: "site:sjer-red",
                kind: "archive" as const,
                uri: archiveUri(number),
                digest: digestOf(number),
                version: `2.0.0-${String(number)}`,
              },
            ]
          : []),
        ...(image
          ? [
              {
                id: `site/image/${String(number)}`,
                component: "image:sjer-red",
                kind: "image" as const,
                uri: "docker.io/shepherdjerred/sjer-red",
                digest: digestOf(number),
                version: `2.0.0-${String(number)}`,
              },
            ]
          : []),
      ],
      retainedArtifactIds,
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}

test("a produced self-hosted archive holds its build pending until the executor records its replica; images and charts need none", async () => {
  const build = await publishSite(1);
  expect(
    await delivery.qualify(build.buildId, "verified", testExecutor),
  ).toEqual({ status: "pending" });
  const row = await delivery.build(build.buildId);
  expect(row.status).toBe("pending");
  expect(await cluster.database.versionSet.count()).toBe(0);
  expect(
    await cluster.database.audit.count({ where: { action: "build.verified" } }),
  ).toBe(0);
  const images = await delivery.publish(testPublication(2), testPublisher, {
    repositoryId: 1,
    pipelineNumber: 2,
  });
  expect(
    await delivery.qualify(images.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  expect(await client().pendingReplication()).toEqual({
    artifacts: [
      {
        artifactId: "site/archive/1",
        buildId: build.buildId,
        serviceId: "static-sites",
        uri: archiveUri(1),
        digest: digestOf(1),
      },
    ],
  });
  const receipt = testReplication(digestOf(1));
  expect(
    await client().recordReplication({
      artifactId: "site/archive/1",
      replication: receipt,
    }),
  ).toMatchObject({ id: "site/archive/1", replication: receipt });
  expect(await client().pendingReplication()).toEqual({ artifacts: [] });
  expect(
    await delivery.qualify(build.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  const [version] = await delivery.versions("static-sites");
  expect(version?.components["site:sjer-red"]).toMatchObject({
    id: "site/archive/1",
    replication: receipt,
  });
  expect(
    await cluster.database.audit.count({
      where: { action: "artifact.replicated", entityId: "site/archive/1" },
    }),
  ).toBe(1);
});

test("receipts name the exact bytes of a self-hosted artifact, replay identically and never change", async () => {
  const build = await publishSite(1);
  await delivery.publish(testPublication(2), testPublisher, {
    repositoryId: 1,
    pipelineNumber: 2,
  });
  const receipt = testReplication(digestOf(1));
  await expect(
    client(publisherToken).recordReplication({
      artifactId: "site/archive/1",
      replication: receipt,
    }),
  ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  await expect(
    client(publisherToken).pendingReplication(),
  ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  await expect(
    client().recordReplication({
      artifactId: "site/archive/1",
      replication: { ...receipt, digest: `sha256:${"f".repeat(64)}` },
    }),
  ).rejects.toMatchObject({ status: 400, code: "INVALID" });
  await expect(
    client().recordReplication({
      artifactId: "image/2",
      replication: { ...receipt, digest: `sha256:${"c".repeat(64)}` },
    }),
  ).rejects.toMatchObject({ status: 400, code: "INVALID" });
  await expect(
    client().recordReplication({ artifactId: "missing", replication: receipt }),
  ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  expect(
    await delivery.qualify(build.buildId, "verified", testExecutor),
  ).toEqual({ status: "pending" });
  const first = await client().recordReplication({
    artifactId: "site/archive/1",
    replication: receipt,
  });
  expect(
    await client().recordReplication({
      artifactId: "site/archive/1",
      replication: receipt,
    }),
  ).toEqual(first);
  await expect(
    client().recordReplication({
      artifactId: "site/archive/1",
      replication: { ...receipt, key: "elsewhere/" + receipt.key },
    }),
  ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  expect(
    await cluster.database.audit.count({
      where: { action: "artifact.replicated" },
    }),
  ).toBe(1);
  expect(
    await cluster.database.artifact.findUniqueOrThrow({
      where: { id: "site/archive/1" },
    }),
  ).toMatchObject({ replication: receipt });
});

test("the pending list names only produced, unreplicated self-hosted artifacts of pending builds", async () => {
  const first = await publishSite(1);
  await client().recordReplication({
    artifactId: "site/archive/1",
    replication: testReplication(digestOf(1)),
  });
  expect(
    await delivery.qualify(first.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  const retaining = await publishSite(2, {
    archive: false,
    image: true,
    retainedArtifactIds: ["site/archive/1"],
  });
  const failed = await publishSite(3);
  expect(
    await delivery.qualify(failed.buildId, "failed", testExecutor),
  ).toEqual({ status: "failed" });
  const produced = await publishSite(4, { image: true });
  expect(await client().pendingReplication()).toEqual({
    artifacts: [
      {
        artifactId: "site/archive/4",
        buildId: produced.buildId,
        serviceId: "static-sites",
        uri: archiveUri(4),
        digest: digestOf(4),
      },
    ],
  });
  expect(
    await delivery.qualify(retaining.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  const [latest] = await delivery.versions("static-sites");
  expect(latest?.components["site:sjer-red"]?.id).toBe("site/archive/1");
  expect(latest?.components["image:sjer-red"]?.id).toBe("site/image/2");
});

test("a licensed forum bundle is not read or verified before its replica receipt exists", async () => {
  const digest = `sha256:${"d".repeat(64)}`;
  const acquired = await delivery.publishForumBundle(
    {
      requestId: "forum/license",
      serviceId: "storm-forum",
      artifact: {
        id: "forum-bundle",
        kind: "archive",
        component: "archive:forum-bundle",
        uri: `s3://storm-forum-releases/releases/${"d".repeat(64)}.zip`,
        digest,
        version: forumBundlePolicy.xenforoVersion,
        origin: {
          kind: "licensed-bundle",
          manifestDigest: forumBundlePolicyDigest(),
          xenforoVersion: forumBundlePolicy.xenforoVersion,
          producerSourceRevision: "e".repeat(40),
        },
      },
    },
    testPublisher,
  );
  expect(acquired.status).toBe("pending");
  const held = await delivery.qualifyForumBundle(
    acquired.buildId,
    testExecutor,
    () => {
      throw new Error("Bundle bytes must not be read before replication");
    },
  );
  expect(held.status).toBe("pending");
  const pending = await client().pendingReplication();
  expect(pending.artifacts.map((entry) => entry.artifactId)).toEqual([
    "forum-bundle",
  ]);
  await client().recordReplication({
    artifactId: "forum-bundle",
    replication: testReplication(digest),
  });
  let read = false;
  const verified = await delivery.qualifyForumBundle(
    acquired.buildId,
    testExecutor,
    () => {
      read = true;
      return Promise.resolve();
    },
  );
  expect(read).toBe(true);
  expect(verified.status).toBe("verified");
  expect(verified.artifact.replication).toMatchObject({ store: "r2", digest });
});
