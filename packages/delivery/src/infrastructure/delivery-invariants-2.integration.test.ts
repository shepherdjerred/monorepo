import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "#testing/seed.ts";
import { Delivery } from "./delivery.ts";
import type { CreateDeployment, PublishBuild } from "#shared/contract.ts";

function publication(number: number): PublishBuild {
  return {
    requestId: `publish/${String(number)}`,
    serviceId: "arcade",
    sourceRevision: "b".repeat(40),
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
    verifiedAt: new Date().toISOString(),
    artifacts: [
      {
        id: `image/${String(number)}`,
        component: "server",
        kind: "image",
        uri: "docker.io/shepherdjerred/arcade",
        version: `1.0.${String(number)}`,
        digest: `sha256:${"c".repeat(64)}`,
      },
    ],
  };
}

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof seedDelivery>>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
  );
  fixture = await seedDelivery(delivery);
});
function input(requestId = "deploy/1"): CreateDeployment {
  return {
    requestId,
    environmentId: fixture.environment.id,
    versionSetRevisionId: fixture.versionSet.id,
    expectedGeneration: fixture.environment.generation,
    kind: "deploy",
  };
}
describe("PostgreSQL delivery invariants 2.1", () => {
  test("stages retain operation identity and completed evidence", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await delivery.claim(deployment.id, testExecutor);
    await delivery.stage(
      deployment.id,
      {
        key: "preflight",
        operationId: "op/1",
        status: "running",
        message: "inspect",
        evidence: [],
      },
      testExecutor,
    );
    await delivery.stage(
      deployment.id,
      {
        key: "preflight",
        operationId: "op/1",
        status: "succeeded",
        message: "safe",
        evidence: [{ kind: "preflight", summary: "selectors compatible" }],
      },
      testExecutor,
    );
    await expect(
      delivery.stage(
        deployment.id,
        {
          key: "preflight",
          operationId: "op/2",
          status: "running",
          message: "rewrite",
          evidence: [],
        },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const detail = await delivery.detail(deployment.id);
    expect(detail.evidence).toHaveLength(1);
  });
  test("pending cancellation removes outbox without changing desired state", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await delivery.cancel(deployment.id, testOperator);
    const pending = await delivery.pending();
    const overview = await delivery.overview();
    expect(pending.deployments).toEqual([]);
    expect(overview.environments[0]?.desiredVersionSetRevisionId).toBeNull();
  });
  test("publication callback retry ignores an untrusted wall clock while preserving artifact identity", async () => {
    const original = publication(2);
    const first = await delivery.publish(original, testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    const duplicate = await delivery.publish(
      { ...original, verifiedAt: "2026-10-17T00:00:00.000Z" },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 2 },
    );
    expect(duplicate.buildId).toBe(first.buildId);
    await expect(
      delivery.publish(
        { ...original, sourceRevision: "d".repeat(40) },
        testPublisher,
        { repositoryId: 1, pipelineNumber: 2 },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("concurrent qualification serializes version selection by pipeline order", async () => {
    const older = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    const newer = await delivery.publish(publication(3), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 3,
    });
    await Promise.all([
      delivery.qualify(older.buildId, "verified", testExecutor),
      delivery.qualify(newer.buildId, "verified", testExecutor),
    ]);
    const revisions = await delivery.versions("arcade");
    expect(revisions[0]?.components["server"]?.id).toBe("image/3");
  });
});
describe("PostgreSQL delivery invariants 2.2", () => {
  test("the previous accepted configuration and version set are frozen with the request", async () => {
    const first = await delivery.createDeployment(input(), testOperator);
    await delivery.claim(first.id, testExecutor);
    await delivery.finish(
      first.id,
      {
        status: "succeeded",
        message: "accepted",
        observedRevisionId: fixture.versionSet.id,
        evidence: [
          { kind: "reconciliation", summary: "exact operation completed" },
          { kind: "acceptance", summary: "acceptance checks passed" },
        ],
        recoveryRequired: false,
      },
      testExecutor,
    );
    await cluster.database.environment.update({
      where: { id: fixture.environment.id },
      data: {
        configurationRevision: "config/2",
        configuration: { mode: "next" },
      },
    });
    const next = await delivery.createDeployment(
      { ...input("next"), expectedGeneration: 1 },
      testOperator,
    );
    expect(next.previousAcceptedVersionSetRevisionId).toBe(
      fixture.versionSet.id,
    );
    expect(next.previousAcceptedConfiguration).toEqual({});
    const snapshot = await delivery.detail(next.id);
    expect(snapshot.previousAcceptedVersionSet?.id).toBe(fixture.versionSet.id);
    expect(snapshot.deployment.configuration).toEqual({ mode: "next" });
  });
  test("unverified imports cannot become version sets or deployment acceptance", async () => {
    const snapshot = await delivery.importSnapshot(
      {
        requestId: "import/1",
        serviceId: "arcade",
        environmentId: fixture.environment.id,
        capturedAt: new Date().toISOString(),
        source: "argocd",
        components: {
          server: { uri: "docker.io/shepherdjerred/arcade", version: "legacy" },
        },
        evidence:
          "Imported source pin; runtime acceptance has not been checked",
      },
      testOperator,
    );
    expect(snapshot.verified).toBe(false);
    expect(await cluster.database.importedSnapshot.count()).toBe(1);
    await expect(
      delivery.compose(
        {
          requestId: "bad-import-compose",
          serviceId: "arcade",
          components: { server: snapshot.id },
        },
        testPublisher,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  test("Scout production approval is human-only and bound to the frozen generation", async () => {
    const build = await delivery.publish(
      {
        ...publication(5),
        serviceId: "scout-for-lol",
        requestId: "scout-build",
        artifacts: [
          {
            id: "scout-image",
            component: "server",
            kind: "image",
            uri: "docker.io/shepherdjerred/scout-for-lol",
            digest: `sha256:${"e".repeat(64)}`,
            version: "build-5",
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 5 },
    );
    await delivery.qualify(build.buildId, "verified", testExecutor);
    const revisions = await delivery.versions("scout-for-lol");
    const selected = revisions[0];
    if (selected === undefined) throw new Error("Scout version set missing");
    await delivery.registerPipeline(
      "scout-pipeline",
      { kind: "manual", reason: "Approval boundary test" },
      testOperator,
    );
    await delivery.registerEnvironment(
      {
        id: "scout/prod",
        serviceId: "scout-for-lol",
        name: "prod",
        application: "scout-prod",
        pipelineRevisionId: "scout-pipeline",
        configurationRevision: "config/1",
        configuration: {},
        automatic: true,
      },
      testOperator,
    );
    const deployment = await delivery.createDeployment(
      {
        requestId: "scout-deploy",
        environmentId: "scout/prod",
        versionSetRevisionId: selected.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    expect(deployment.status).toBe("awaiting_approval");
    expect(await cluster.database.outbox.count()).toBe(0);
    await expect(
      delivery.approve(deployment.id, "approve", "not a human", testExecutor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cluster.database.environment.update({
      where: { id: "scout/prod" },
      data: { generation: { increment: 1 } },
    });
    await expect(
      delivery.approve(
        deployment.id,
        "approve",
        "reviewed exact inputs",
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("environment configuration cannot change while a deployment is pending or active", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    const registration = {
      id: fixture.environment.id,
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/1",
      configurationRevision: "config/2",
      configuration: { changed: "yes" },
      automatic: true,
    };
    await expect(
      delivery.registerEnvironment(registration, testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await delivery.claim(deployment.id, testExecutor);
    await expect(
      delivery.registerEnvironment(registration, testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
