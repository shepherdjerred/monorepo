import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testPublisher } from "#testing/seed.ts";
import { AcquireUpstreamArtifactSchema } from "#shared/contract.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";

const context = useDeliveryFixture();
const bytes = new TextEncoder().encode("independent upstream archive fixture");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const input = AcquireUpstreamArtifactSchema.parse({
  requestId: "upstream/initial",
  serviceId: "minecraft",
  sourceRevision: "a".repeat(40),
  artifact: {
    id: "upstream/minecraft/original",
    component: "chart:minecraft",
    kind: "chart",
    uri: "https://chartmuseum.sjer.red/charts/minecraft-4.0.0.tgz",
    version: "4.0.0",
    digest,
    origin: {
      kind: "upstream",
      repository: "https://itzg.github.io/minecraft-server-charts/",
      name: "minecraft",
      version: "4.0.0",
      checksum: digest,
    },
  },
});
function transport(url: string | URL) {
  if (url.toString().endsWith("index.yaml"))
    return Promise.resolve(
      Response.json({
        entries: {
          minecraft: [
            {
              name: "minecraft",
              version: "4.0.0",
              digest: digest.slice(7),
              urls: [
                "https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-4.0.0/minecraft-4.0.0.tgz",
              ],
            },
          ],
        },
      }),
    );
  return Promise.resolve(new Response(bytes));
}
async function publish(number: number, retainedArtifactIds: string[]) {
  return context.delivery.publish(
    {
      requestId: `minecraft/ci/${String(number)}`,
      serviceId: "minecraft",
      sourceRevision: String(number).repeat(40).slice(0, 40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [],
      retainedArtifactIds,
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}

test("independent acquisitions converge on original upstream identity despite concurrent CI sources and failed unrelated CI", async () => {
  const [first, second] = await Promise.all([
    context.delivery.acquireUpstreamArtifact(input, testPublisher, transport),
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/concurrent",
        sourceRevision: "b".repeat(40),
        artifact: { ...input.artifact, id: "caller/proposed/clone" },
      },
      testPublisher,
      transport,
    ),
  ]);
  expect(first.artifact).toEqual(second.artifact);
  expect(first.status).toBe("verified");
  const originalBuild = await context.delivery.build(first.buildId);
  expect(originalBuild).toMatchObject({
    sourceKind: "upstream",
    ciUrl: null,
    repositoryId: null,
    pipelineNumber: null,
  });
  expect(await context.delivery.versions("minecraft")).toHaveLength(0);
  const failed = await publish(2, [first.artifact.id]);
  await context.delivery.qualify(failed.buildId, "failed", testExecutor);
  const retainedBuild = await context.delivery.build(first.buildId);
  expect(retainedBuild.status).toBe("verified");
  const genuine = await publish(3, [first.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  const versions = await context.delivery.versions("minecraft");
  expect(versions).toHaveLength(1);
  expect(versions[0]?.components["chart:minecraft"]).toMatchObject({
    id: first.artifact.id,
    buildId: first.buildId,
    sourceRevision: first.artifact.sourceRevision,
    origin: input.artifact.origin,
  });
  expect(
    await context.cluster.database.artifact.count({
      where: { originKey: { not: null } },
    }),
  ).toBe(1);
});

test("retaining the same original component is an audited CI no-op and manual composition cannot become its automatic base", async () => {
  const acquired = await context.delivery.acquireUpstreamArtifact(
    input,
    testPublisher,
    transport,
  );
  const genuine = await publish(2, [acquired.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  const [original] = await context.delivery.versions("minecraft");
  if (original === undefined) throw new Error("Missing genuine CI version");
  await context.delivery.compose(
    {
      requestId: "manual/upstream-selection",
      serviceId: "minecraft",
      components: { "chart:minecraft": acquired.artifact.id },
    },
    testPublisher,
  );
  const repeated = await publish(3, [acquired.artifact.id]);
  await context.delivery.qualify(repeated.buildId, "verified", testExecutor);
  expect(
    await context.cluster.database.versionSet.count({
      where: { serviceId: "minecraft" },
    }),
  ).toBe(2);
  expect(
    await context.cluster.database.versionSet.findUnique({
      where: { qualifiedBuildId: repeated.buildId },
    }),
  ).toBeNull();
  const selected = await context.delivery.latestQualifiedArtifact(
    { serviceId: "minecraft", component: "chart:minecraft", kind: "chart" },
    1,
  );
  expect(selected.id).toBe(acquired.artifact.id);
});

test("acquisition and exact lookup use real HTTP auth, original provenance and independent allowlisted bytes", async () => {
  const app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    upstreamFetch: transport,
    peerAddress: () => null,
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: [
        { token: "upstream-test-publisher", principal: testPublisher },
      ],
    },
  });
  const client = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: "Bearer upstream-test-publisher" },
    fetch: async (url, init) => app.request(url, init),
  });
  const acquired = await client.acquireUpstreamArtifact(input);
  expect(
    await client.findQualifiedArtifact({
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
      digest,
      version: "4.0.0",
      originKind: "upstream",
    }),
  ).toEqual(acquired.artifact);
  await expect(
    client.findQualifiedArtifact({
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
      digest: `sha256:${"f".repeat(64)}`,
      version: "4.0.0",
      originKind: "upstream",
    }),
  ).rejects.toMatchObject({ status: 404 });
  let reads = 0;
  await expect(
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/ssrf",
        artifact: { ...input.artifact, uri: "http://127.0.0.1/private" },
      },
      testPublisher,
      async () => {
        reads++;
        return new Response(bytes);
      },
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(reads).toBe(0);
  await expect(
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/conflict",
        artifact: {
          ...input.artifact,
          digest: `sha256:${"f".repeat(64)}`,
          origin: {
            ...input.artifact.origin,
            kind: "upstream",
            repository: "https://itzg.github.io/minecraft-server-charts/",
            name: "minecraft",
            version: "4.0.0",
            checksum: `sha256:${"f".repeat(64)}`,
          },
        },
      },
      testPublisher,
      transport,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("independent verification rejects corrupt bytes and transient read failures remain honestly pending", async () => {
  await expect(
    context.delivery.acquireUpstreamArtifact(
      input,
      testPublisher,
      async (url) =>
        url.toString().endsWith("index.yaml")
          ? transport(url)
          : new Response("corrupt"),
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  const pending = await context.cluster.database.build.findUniqueOrThrow({
    where: { requestId: input.requestId },
  });
  expect(pending.status).toBe("pending");
  expect(await context.delivery.pendingQualification()).toMatchObject({
    builds: [],
  });
  const repaired = await context.delivery.acquireUpstreamArtifact(
    input,
    testPublisher,
    transport,
  );
  expect(repaired.status).toBe("verified");
});
