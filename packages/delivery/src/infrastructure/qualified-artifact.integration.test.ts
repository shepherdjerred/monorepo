import { describe, expect, test } from "vitest";
import { useDeliveryHttp } from "#testing/delivery-http-fixture.ts";
import { testExecutor, testPublisher, testOperator } from "#testing/seed.ts";
import { replicateProducedArtifacts } from "#testing/replication.ts";

const query = {
  serviceId: "scout-for-lol",
  component: "image:scout-for-lol",
  kind: "image" as const,
};
const readerToken = "read-only-qualified-artifact-test-credential";
const harness = useDeliveryHttp({
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
  writesEnabled: false,
  defaultToken: readerToken,
});
const { client } = harness;
async function publication(
  number: number,
  status: "pending" | "verified" | "failed" = "pending",
  repositoryId = 1,
) {
  const sourceRevision = String(number).padStart(40, "0");
  const artifactId = `image/${String(repositoryId)}/${String(number)}`;
  const build = await harness.delivery.publish(
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
    await harness.delivery.qualify(build.buildId, status, testExecutor);
  return { artifactId, buildId: build.buildId, sourceRevision };
}

async function sitePublication(input: {
  number: number;
  requiredDigest: string;
  imageId?: string;
  siteDigest?: string;
}) {
  const {
    number,
    requiredDigest,
    imageId,
    siteDigest = "a".repeat(64),
  } = input;
  return harness.delivery.publish(
    {
      requestId: `release/${String(number)}`,
      serviceId: query.serviceId,
      sourceRevision: String(number).padStart(40, "0"),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        ...(imageId === undefined
          ? []
          : [
              {
                id: imageId,
                component: query.component,
                kind: query.kind,
                uri: "docker.io/shepherdjerred/scout-for-lol",
                version: `build-${String(number)}`,
                digest: requiredDigest,
              },
            ]),
        {
          id: `site/${String(number)}`,
          component: "site:scout-frontend-beta",
          kind: "archive",
          uri: `s3://delivery-artifacts/sites/scout-frontend-beta/${siteDigest}.tar`,
          version: `build-${String(number)}`,
          digest: `sha256:${siteDigest}`,
          requires: { [query.component]: requiredDigest },
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}

describe("latest qualified artifact reads over PostgreSQL and the authenticated API", () => {
  test("orders genuine configured-repository CI pipelines and ignores pending, failed, late older and manual selections", async () => {
    const newest = await publication(10, "verified");
    await publication(11);
    await publication(12, "failed");
    const lateOlder = await publication(9, "verified");
    await harness.delivery.compose(
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
      await harness.cluster.database.request.count({
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
    const anonymous = await harness.app.request(
      `${path}?${new URLSearchParams(query).toString()}`,
    );
    expect(anonymous.status).toBe(401);
    const headers = { Authorization: `Bearer ${readerToken}` };
    for (const params of [
      "serviceId=scout-for-lol&component=image:scout-for-lol&kind=script",
      "serviceId=scout-for-lol&component=image:scout-for-lol",
      "serviceId=scout-for-lol&component=bad%20component&kind=image",
    ]) {
      const response = await harness.app.request(`${path}?${params}`, {
        headers,
      });
      expect(response.status).toBe(400);
    }
    const selected = await client().latestQualifiedArtifact(query);
    expect(selected.id).toBe("image/1/1");
  });
});

test("late verified outputs cannot replace the image in the newest coherent automatic set", async () => {
  const a = `sha256:${"a".repeat(64)}`;
  const b = `sha256:${"b".repeat(64)}`;
  const one = await sitePublication({
    number: 1,
    requiredDigest: a,
    imageId: "image/a",
  });
  const two = await sitePublication({
    number: 2,
    requiredDigest: b,
    imageId: "image/b",
  });
  const three = await sitePublication({ number: 3, requiredDigest: a });
  for (const build of [one, three, two]) {
    await replicateProducedArtifacts(harness.delivery, build.buildId);
    expect(
      await harness.delivery.qualify(build.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
  }
  // Build three republished the same site bytes, so it composed no revision.
  expect(
    await harness.cluster.database.versionSet.count({
      where: { qualifiedBuildId: three.buildId },
    }),
  ).toBe(0);
  expect(
    await harness.cluster.database.versionSet.count({
      where: { qualifiedBuildId: two.buildId },
    }),
  ).toBe(0);
  await harness.delivery.compose(
    {
      requestId: "manual-late-b",
      serviceId: query.serviceId,
      components: { [query.component]: "image/b" },
    },
    testOperator,
  );
  const selected = await client().latestQualifiedArtifact(query);
  expect(selected).toMatchObject({
    id: "image/a",
    buildId: one.buildId,
    sourceRevision: "1".padStart(40, "0"),
    digest: a,
  });
  const four = await sitePublication({
    number: 4,
    requiredDigest: selected.digest,
    siteDigest: "4".repeat(64),
  });
  await replicateProducedArtifacts(harness.delivery, four.buildId);
  expect(
    await harness.delivery.qualify(four.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  const latest = await harness.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: four.buildId },
  });
  const coherent = await harness.delivery.version(latest.id);
  expect(coherent.components[query.component]?.id).toBe(selected.id);
  expect(coherent.components["site:scout-frontend-beta"]?.id).toBe("site/4");
});

test("a missing component in the newest coherent set does not fall back to an older set", async () => {
  await publication(1, "verified");
  const newest = await publication(2, "verified");
  const version = await harness.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: newest.buildId },
  });
  // Model a newest set without this component; the older set still has it.
  await harness.cluster.database.versionSetEntry.deleteMany({
    where: { revisionId: version.id, component: query.component },
  });
  await expect(client().latestQualifiedArtifact(query)).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
  });
});

test("automatic qualification retains qualified image B across a manual A composition when site C requires B", async () => {
  const a = await publication(1, "verified");
  const versionA = await harness.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: a.buildId },
  });
  await harness.delivery.registerPipeline(
    "scout-beta/test",
    {
      kind: "manual",
      reason: "Persistence selection fixture; no external operation runs",
    },
    testOperator,
  );
  const env = await harness.delivery.registerEnvironment(
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
  const accepted = await harness.delivery.createDeployment(
    {
      requestId: "accept-a",
      environmentId: env.id,
      versionSetRevisionId: versionA.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await harness.delivery.claim(accepted.id, testExecutor);
  await harness.delivery.finish(
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
  const versionB = await harness.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: b.buildId },
  });
  const manual = await harness.delivery.compose(
    {
      requestId: "manual-a",
      serviceId: query.serviceId,
      components: { [query.component]: a.artifactId },
    },
    testPublisher,
  );
  const selectedImage = await client().latestQualifiedArtifact(query);
  const c = await harness.delivery.publish(
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
  await replicateProducedArtifacts(harness.delivery, c.buildId);
  expect(
    await harness.delivery.qualify(c.buildId, "verified", testExecutor),
  ).toEqual({
    status: "verified",
  });
  const versionC = await harness.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: c.buildId },
  });
  expect(versionC.baseRevisionId).toBe(versionB.id);
  expect(versionC.revision).toBe(manual.revision + 1);
  const preservedManual = await harness.delivery.version(manual.id);
  expect(preservedManual.components[query.component]?.id).toBe(a.artifactId);
  const automated = await harness.delivery.reconcile([env.id], testExecutor);
  expect(automated.deployments).toHaveLength(1);
  const requestedId = automated.deployments[0];
  if (requestedId === undefined) throw new Error("Automatic selection missing");
  const requested = await harness.cluster.database.deployment.findUniqueOrThrow(
    {
      where: { id: requestedId },
    },
  );
  expect(requested.versionSetRevisionId).toBe(versionC.id);
  const unchangedAcceptance =
    await harness.cluster.database.environment.findUniqueOrThrow({
      where: { id: env.id },
    });
  expect(unchangedAcceptance.acceptedVersionSetRevisionId).toBe(versionA.id);
  const selected = await harness.delivery.version(versionC.id);
  expect(selected.components[query.component]?.id).toBe(b.artifactId);
  expect(selected.components["site:scout-frontend-beta"]?.id).toBe("site/c");
});
