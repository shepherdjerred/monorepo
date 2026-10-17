import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { testExecutor, testPublisher, testOperator } from "#testing/seed.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { Delivery } from "./delivery.ts";

const query = {
  serviceId: "scout-for-lol",
  component: "image:scout-for-lol",
  kind: "image" as const,
};
const readerToken = "read-only-qualified-artifact-test-credential";
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
        {
          token: readerToken,
          principal: {
            id: "artifact-reader",
            kind: "machine",
            scopes: ["read"],
          },
        },
      ],
      writesEnabled: async () => false,
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
function client() {
  return createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: `Bearer ${readerToken}` },
    fetch: async (input, init) => app.request(input, init),
  });
}
async function publication(
  number: number,
  status: "pending" | "verified" | "failed" = "pending",
  repositoryId = 1,
) {
  const sourceRevision = String(number).padStart(40, "0");
  const artifactId = `image/${String(repositoryId)}/${String(number)}`;
  const build = await delivery.publish(
    {
      requestId: `qualified/${String(repositoryId)}/${String(number)}`,
      serviceId: query.serviceId,
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/${String(repositoryId)}/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: artifactId,
          component: query.component,
          kind: query.kind,
          uri: "docker.io/shepherdjerred/scout-for-lol",
          version: `build-${String(number)}`,
          digest: `sha256:${number.toString(16).padStart(64, "0")}`,
        },
      ],
    },
    testPublisher,
    { repositoryId, pipelineNumber: number },
  );
  if (status !== "pending")
    await delivery.qualify(build.buildId, status, testExecutor);
  return { artifactId, buildId: build.buildId, sourceRevision };
}

describe("latest qualified artifact reads over PostgreSQL and the authenticated API", () => {
  test("orders genuine configured-repository CI pipelines and ignores pending, failed, late older and manual selections", async () => {
    const newest = await publication(10, "verified");
    await publication(11);
    await publication(12, "failed");
    const lateOlder = await publication(9, "verified");
    await delivery.compose(
      {
        requestId: "manual-select-old",
        serviceId: query.serviceId,
        components: { [query.component]: lateOlder.artifactId },
      },
      testPublisher,
    );
    await publication(100, "verified", 2);
    const selected = await client().latestQualifiedArtifact(query);
    expect(selected).toMatchObject({
      id: newest.artifactId,
      buildId: newest.buildId,
      sourceRevision: newest.sourceRevision,
      serviceId: query.serviceId,
      component: query.component,
      kind: query.kind,
      version: "build-10",
    });
    expect(
      await cluster.database.request.count({
        where: { resultType: "deployment" },
      }),
    ).toBe(0);
  });
  test("returns a typed missing result instead of using a pending artifact or another component kind", async () => {
    await publication(1);
    await expect(client().latestQualifiedArtifact(query)).rejects.toMatchObject(
      { status: 404, code: "NOT_FOUND" },
    );
    await publication(2, "verified");
    await expect(
      client().latestQualifiedArtifact({ ...query, kind: "chart" }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(
      client().latestQualifiedArtifact({
        ...query,
        component: "image:missing",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(
      client().latestQualifiedArtifact({ ...query, serviceId: "arcade" }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
  test("requires read authentication and validates all query fields while writes are paused", async () => {
    await publication(1, "verified");
    const path = "/api/v1/artifacts/latest-qualified";
    const anonymous = await app.request(
      `${path}?${new URLSearchParams(query).toString()}`,
    );
    expect(anonymous.status).toBe(401);
    const headers = { Authorization: `Bearer ${readerToken}` };
    for (const params of [
      "serviceId=scout-for-lol&component=image:scout-for-lol&kind=script",
      "serviceId=scout-for-lol&component=image:scout-for-lol",
      "serviceId=scout-for-lol&component=bad%20component&kind=image",
    ]) {
      const response = await app.request(`${path}?${params}`, { headers });
      expect(response.status).toBe(400);
    }
    const selected = await client().latestQualifiedArtifact(query);
    expect(selected.id).toBe("image/1/1");
  });
});

test("automatic qualification retains qualified image B across a manual A composition when site C requires B", async () => {
  const a = await publication(1, "verified");
  const versionA = await cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: a.buildId },
  });
  await delivery.registerPipeline(
    "scout-beta/test",
    {
      kind: "manual",
      reason: "Persistence selection fixture; no external operation runs",
    },
    testOperator,
  );
  const env = await delivery.registerEnvironment(
    {
      id: "scout/beta",
      serviceId: query.serviceId,
      name: "beta",
      application: "scout-beta",
      pipelineRevisionId: "scout-beta/test",
      configurationRevision: "test/1",
      configuration: {},
      automatic: true,
    },
    testOperator,
  );
  const accepted = await delivery.createDeployment(
    {
      requestId: "accept-a",
      environmentId: env.id,
      versionSetRevisionId: versionA.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await delivery.claim(accepted.id, testExecutor);
  await delivery.finish(
    accepted.id,
    {
      status: "succeeded",
      message: "Accepted persistence fixture",
      observedRevisionId: versionA.id,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "Fixture target applied" },
        { kind: "acceptance", summary: "Fixture target accepted" },
      ],
    },
    testExecutor,
  );
  const b = await publication(2, "verified");
  const versionB = await cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: b.buildId },
  });
  const manual = await delivery.compose(
    {
      requestId: "manual-a",
      serviceId: query.serviceId,
      components: { [query.component]: a.artifactId },
    },
    testPublisher,
  );
  const selectedImage = await client().latestQualifiedArtifact(query);
  const c = await delivery.publish(
    {
      requestId: "site-c",
      serviceId: query.serviceId,
      sourceRevision: "3".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/3",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "site/c",
          component: "site:scout-frontend-beta",
          kind: "archive",
          uri: `s3://delivery-artifacts/sites/scout-frontend-beta/${"c".repeat(64)}.tar`,
          digest: `sha256:${"c".repeat(64)}`,
          version: "build-3",
          requires: { [query.component]: selectedImage.digest },
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 3 },
  );
  expect(await delivery.qualify(c.buildId, "verified", testExecutor)).toEqual({
    status: "verified",
  });
  const versionC = await cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: c.buildId },
  });
  expect(versionC.baseRevisionId).toBe(versionB.id);
  expect(versionC.revision).toBe(manual.revision + 1);
  const preservedManual = await delivery.version(manual.id);
  expect(preservedManual.components[query.component]?.id).toBe(a.artifactId);
  const automated = await delivery.reconcile([env.id], testExecutor);
  expect(automated.deployments).toHaveLength(1);
  const requestedId = automated.deployments[0];
  if (requestedId === undefined) throw new Error("Automatic selection missing");
  const requested = await cluster.database.deployment.findUniqueOrThrow({
    where: { id: requestedId },
  });
  expect(requested.versionSetRevisionId).toBe(versionC.id);
  const unchangedAcceptance =
    await cluster.database.environment.findUniqueOrThrow({
      where: { id: env.id },
    });
  expect(unchangedAcceptance.acceptedVersionSetRevisionId).toBe(versionA.id);
  const selected = await delivery.version(versionC.id);
  expect(selected.components[query.component]?.id).toBe(b.artifactId);
  expect(selected.components["site:scout-frontend-beta"]?.id).toBe("site/c");
});
