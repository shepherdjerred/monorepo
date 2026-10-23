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

async function retaining(number: number, retainedArtifactId: string) {
  return harness.delivery.publish(
    {
      requestId: `retaining/${String(number)}`,
      serviceId: query.serviceId,
      sourceRevision: String(number).padStart(40, "0"),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [],
      retainedArtifactIds: [retainedArtifactId],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}

async function buildRow(buildId: string) {
  return harness.cluster.database.build.findUniqueOrThrow({
    where: { id: buildId },
  });
}

async function retainableId(beforePipeline: number) {
  const artifact = await client().latestRetainableArtifact({
    ...query,
    beforePipeline,
  });
  return artifact.id;
}

async function qualifiedId() {
  const artifact = await client().latestQualifiedArtifact(query);
  return artifact.id;
}

async function serviceSets() {
  return harness.cluster.database.versionSet.count({
    where: { serviceId: query.serviceId },
  });
}

describe("back-to-back pipelines retain a pending original by reference", () => {
  test("the retainable read takes the newest pending or verified original before the producer's own pipeline", async () => {
    await publication(8);
    const live = await publication(10, "verified");
    await publication(9);
    const pending = await publication(11);
    await publication(12, "failed");
    await publication(14, "pending", 2);
    expect(
      await client().latestRetainableArtifact({ ...query, beforePipeline: 13 }),
    ).toMatchObject({
      id: pending.artifactId,
      buildId: pending.buildId,
      sourceRevision: pending.sourceRevision,
    });
    expect(await retainableId(12)).toBe(pending.artifactId);
    // Its own and later pipelines are never a base, nor pending builds the
    // live set supersedes (R4): the read falls back to the live entry.
    expect(await retainableId(11)).toBe(live.artifactId);
    expect(await retainableId(9)).toBe(live.artifactId);
    expect(await qualifiedId()).toBe(live.artifactId);
    await expect(
      client().latestRetainableArtifact({
        ...query,
        kind: "chart",
        beforePipeline: 13,
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    const path = "/api/v1/artifacts/latest-retainable";
    const anonymous = await harness.app.request(
      `${path}?${new URLSearchParams({ ...query, beforePipeline: "13" }).toString()}`,
    );
    expect(anonymous.status).toBe(401);
    const headers = { Authorization: `Bearer ${readerToken}` };
    for (const beforePipeline of ["", "0", "x"]) {
      const response = await harness.app.request(
        `${path}?${new URLSearchParams({ ...query, beforePipeline }).toString()}`,
        { headers },
      );
      expect(response.status).toBe(400);
    }
  });

  test("before the first set (R0) a pending original is the base, and with none the read is 404", async () => {
    await expect(retainableId(2)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    const first = await publication(1);
    expect(await retainableId(2)).toBe(first.artifactId);
  });

  test("a retaining build stays pending until the referenced build qualifies, then composes no set revision", async () => {
    await publication(1, "verified");
    const changed = await publication(2);
    const baseId = await retainableId(3);
    expect(baseId).toBe(changed.artifactId);
    const retained = await retaining(3, baseId);
    expect(retained.artifacts).toEqual([changed.artifactId]);
    expect(
      await harness.delivery.qualify(
        retained.buildId,
        "verified",
        testExecutor,
      ),
    ).toEqual({ status: "pending" });
    const waiting = await buildRow(retained.buildId);
    expect(waiting.status).toBe("pending");
    // The referenced build never waits on the later build that retains it.
    expect(
      await harness.delivery.qualify(changed.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
    expect(
      await harness.delivery.qualify(
        retained.buildId,
        "verified",
        testExecutor,
      ),
    ).toEqual({ status: "verified" });
    // B2 and R2: the unchanged component is retained, so no set revision.
    expect(
      await harness.cluster.database.versionSet.count({
        where: { qualifiedBuildId: retained.buildId },
      }),
    ).toBe(0);
    expect(await serviceSets()).toBe(2);
    expect(await qualifiedId()).toBe(changed.artifactId);
  });

  test("a failed reference fails the retaining build with a reason naming the retained artifact", async () => {
    const live = await publication(1, "verified");
    const changed = await publication(2);
    const retained = await retaining(3, changed.artifactId);
    expect(
      await harness.delivery.qualify(changed.buildId, "failed", testExecutor),
    ).toEqual({ status: "failed" });
    // A build doomed by a failed reference is no longer a base: pipeline 4 rebuilds.
    expect(await retainableId(4)).toBe(live.artifactId);
    expect(
      await harness.delivery.qualify(
        retained.buildId,
        "verified",
        testExecutor,
      ),
    ).toEqual({ status: "failed" });
    expect(await buildRow(retained.buildId)).toMatchObject({
      status: "failed",
      qualificationReason: `Retained artifact ${changed.artifactId} (${query.component}) belongs to build ${changed.buildId}, which failed qualification`,
    });
    expect(await serviceSets()).toBe(1);
  });

  test("a build never retains a pending original of its own or a later pipeline", async () => {
    const pending = await publication(5);
    for (const number of [5, 4])
      await expect(retaining(number, pending.artifactId)).rejects.toMatchObject(
        { code: "CONFLICT" },
      );
    const failed = await publication(6, "failed");
    await expect(retaining(7, failed.artifactId)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Artifact build has not passed CI qualification",
    });
    expect(
      await harness.cluster.database.build.count({
        where: { requestId: { startsWith: "retaining/" } },
      }),
    ).toBe(0);
  });
});

/** An automatic set revision of the service, as an attested build or a lineage change leaves one. */
async function orderedSet(input: {
  id: string;
  lineage?: string;
  orderMajor: number;
  orderMinor: number;
  artifactId: string;
}) {
  const service = await harness.cluster.database.service.findUniqueOrThrow({
    where: { id: query.serviceId },
  });
  const highest = await harness.cluster.database.versionSet.aggregate({
    where: { serviceId: query.serviceId },
    _max: { revision: true },
  });
  const qualifying = await harness.cluster.database.build.create({
    data: {
      id: `${input.id}/build`,
      requestId: `${input.id}/build`,
      serviceId: query.serviceId,
      sourceRevision: "f".repeat(40),
      sourceKind: "attested",
      status: "verified",
      verifiedAt: new Date(),
    },
  });
  await harness.cluster.database.versionSet.create({
    data: {
      id: input.id,
      serviceId: query.serviceId,
      revision: (highest._max.revision ?? 0) + 1,
      lineage: input.lineage ?? service.lineage,
      orderMajor: input.orderMajor,
      orderMinor: input.orderMinor,
      automatic: true,
      qualifiedBuildId: qualifying.id,
      entries: {
        create: [{ component: query.component, artifactId: input.artifactId }],
      },
    },
  });
  return service;
}

describe("the retainable read follows the current lineage's live set (R4, R5)", () => {
  test("a previous lineage's set ordered above the live set hides no newer build", async () => {
    const live = await publication(10, "verified");
    const service = await orderedSet({
      id: "previous-lineage",
      lineage: "f".repeat(64),
      orderMajor: 30,
      orderMinor: 0,
      artifactId: live.artifactId,
    });
    expect(service.lineage).not.toBe("f".repeat(64));
    const pending = await publication(20);
    expect(await retainableId(25)).toBe(pending.artifactId);
    expect(await retainableId(20)).toBe(live.artifactId);
  });

  test("a live set ordered after a pipeline supersedes that pipeline's pending build", async () => {
    const verified = await publication(10, "verified");
    // An attested set keys after pipeline 12 by its registration sequence.
    await orderedSet({
      id: "attested-after-12",
      orderMajor: 12,
      orderMinor: 5,
      artifactId: verified.artifactId,
    });
    await publication(12);
    expect(await retainableId(13)).toBe(verified.artifactId);
    const later = await publication(13);
    expect(await retainableId(14)).toBe(later.artifactId);
  });
});

async function platformSource(number: number, rootArtifactId: string) {
  const digest = `sha256:${(0xa0_00 + number).toString(16).padStart(64, "0")}`;
  const build = await harness.delivery.publish(
    {
      requestId: `platform/${String(number)}`,
      serviceId: "gitops",
      sourceRevision: String(number).padStart(40, "0"),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `apps/${String(number)}`,
          component: "chart:apps",
          kind: "chart",
          uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/apps-2.0.0-${String(number)}.tgz`,
          version: `2.0.0-${String(number)}`,
          digest,
        },
      ],
      platformChanges: {
        root: true,
        rootArtifacts: { "scout-for-lol": rootArtifactId },
        tofuStacks: [],
        sites: [],
      },
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
  await replicateProducedArtifacts(harness.delivery, build.buildId);
  return build;
}

test("a platform source awaits every pending root original that precedes it in the order key", async () => {
  const earlier = await publication(1);
  const source = await platformSource(2, earlier.artifactId);
  expect(
    await harness.delivery.qualify(source.buildId, "verified", testExecutor),
  ).toEqual({ status: "pending" });
  await harness.delivery.qualify(earlier.buildId, "verified", testExecutor);
  expect(
    await harness.delivery.qualify(source.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  // A sibling registered earlier in the same pipeline is awaited too.
  const sibling = await publication(3);
  const concurrent = await platformSource(3, sibling.artifactId);
  expect(
    await harness.delivery.qualify(
      concurrent.buildId,
      "verified",
      testExecutor,
    ),
  ).toEqual({ status: "pending" });
  await harness.delivery.qualify(sibling.buildId, "verified", testExecutor);
  expect(
    await harness.delivery.qualify(
      concurrent.buildId,
      "verified",
      testExecutor,
    ),
  ).toEqual({ status: "verified" });
  // One registered after the source does not precede it: no wait, no cycle.
  const premature = await platformSource(4, "image/1/4");
  const later = await publication(4);
  expect(
    await harness.delivery.qualify(premature.buildId, "verified", testExecutor),
  ).toEqual({ status: "failed" });
  expect(await buildRow(later.buildId)).toMatchObject({ status: "pending" });
});

test("a build that reaches a failed build through pending references is no retainable base", async () => {
  const site = {
    serviceId: query.serviceId,
    component: "site:scout-frontend-beta",
    kind: "archive" as const,
  };
  const archive = (number: number) => ({
    id: `site/${String(number)}`,
    component: site.component,
    kind: "archive" as const,
    uri: `s3://delivery-artifacts/sites/scout-frontend-beta/${"b".repeat(64)}.tar`,
    version: `build-${String(number)}`,
    digest: `sha256:${"b".repeat(64)}`,
  });
  await publication(1, "verified");
  const failing = await publication(2);
  const publish = (number: number, input: object) =>
    harness.delivery.publish(
      {
        requestId: `chain/${String(number)}`,
        serviceId: query.serviceId,
        sourceRevision: String(number).padStart(40, "0"),
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: [],
        ...input,
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: number },
    );
  await publish(3, {
    artifacts: [archive(3)],
    retainedArtifactIds: [failing.artifactId],
  });
  await publish(4, { retainedArtifactIds: ["site/3"] });
  const retainableSite = (beforePipeline: number) =>
    client().latestRetainableArtifact({ ...site, beforePipeline });
  await expect(retainableSite(5)).resolves.toMatchObject({ id: "site/3" });
  await harness.delivery.qualify(failing.buildId, "failed", testExecutor);
  // Build 4 only reaches failed build 2 through pending build 3.
  await expect(retainableSite(5)).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
  });
});

test("a failed root reference fails a platform source and removes it as a retainable base", async () => {
  const apps = {
    serviceId: "gitops",
    component: "chart:apps",
    kind: "chart" as const,
  };
  const root = await publication(1);
  const source = await platformSource(2, root.artifactId);
  const before = await client().latestRetainableArtifact({
    ...apps,
    beforePipeline: 3,
  });
  expect(before.id).toBe("apps/2");
  await harness.delivery.qualify(root.buildId, "failed", testExecutor);
  // The pending source is doomed, so the next pipeline rebuilds its chart.
  await expect(
    client().latestRetainableArtifact({ ...apps, beforePipeline: 3 }),
  ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  // A failed sibling of the same pipeline fails the source too.
  const sibling = await publication(3, "failed");
  const concurrent = await platformSource(3, sibling.artifactId);
  for (const build of [source, concurrent])
    expect(
      await harness.delivery.qualify(build.buildId, "verified", testExecutor),
    ).toEqual({ status: "failed" });
  expect(await buildRow(concurrent.buildId)).toMatchObject({
    qualificationReason: `Retained artifact ${sibling.artifactId} (${query.component}) belongs to build ${sibling.buildId}, which failed qualification`,
  });
});
