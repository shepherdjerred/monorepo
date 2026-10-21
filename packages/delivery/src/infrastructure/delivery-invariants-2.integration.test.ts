import { describe, expect, test } from "vitest";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import {
  useDeliveryFixture,
  testPublication,
} from "#testing/delivery-fixture.ts";

const context = useDeliveryFixture();
describe("PostgreSQL delivery invariants 2.1", () => {
  test("stages retain operation identity and completed evidence", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.claim(deployment.id, testExecutor);
    await context.delivery.stage(
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
    await context.delivery.stage(
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
      context.delivery.stage(
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
    const detail = await context.delivery.detail(deployment.id);
    expect(detail.evidence).toHaveLength(1);
  });
  test("pending cancellation removes outbox without changing desired state", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.cancel(deployment.id, testOperator);
    const pending = await context.delivery.pending();
    const overview = await context.delivery.overview();
    expect(pending.deployments).toEqual([]);
    expect(overview.environments[0]?.desiredVersionSetRevisionId).toBeNull();
  });
  test("publication callback retry ignores an untrusted wall clock while preserving artifact identity", async () => {
    const original = testPublication(2);
    const first = await context.delivery.publish(original, testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    const duplicate = await context.delivery.publish(
      { ...original, verifiedAt: "2026-10-17T00:00:00.000Z" },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 2 },
    );
    expect(duplicate.buildId).toBe(first.buildId);
    await expect(
      context.delivery.publish(
        { ...original, sourceRevision: "d".repeat(40) },
        testPublisher,
        { repositoryId: 1, pipelineNumber: 2 },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("concurrent qualification serializes version selection by pipeline order", async () => {
    const older = await context.delivery.publish(
      testPublication(2),
      testPublisher,
      {
        repositoryId: 1,
        pipelineNumber: 2,
      },
    );
    const publication = testPublication(3);
    const newer = await context.delivery.publish(
      {
        ...publication,
        // Distinct bytes: identical bytes compose no new revision (R2).
        artifacts: publication.artifacts.map((entry) => ({
          ...entry,
          digest: `sha256:${"d".repeat(64)}`,
        })),
      },
      testPublisher,
      {
        repositoryId: 1,
        pipelineNumber: 3,
      },
    );
    await Promise.all([
      context.delivery.qualify(older.buildId, "verified", testExecutor),
      context.delivery.qualify(newer.buildId, "verified", testExecutor),
    ]);
    const revisions = await context.delivery.versions("arcade");
    expect(revisions[0]?.components["server"]?.id).toBe("image/3");
  });
});
describe("PostgreSQL delivery invariants 2.2", () => {
  test("the previous accepted configuration and version set are frozen with the request", async () => {
    const first = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.claim(first.id, testExecutor);
    await context.delivery.finish(
      first.id,
      {
        status: "succeeded",
        message: "accepted",
        observedRevisionId: context.fixture.versionSet.id,
        evidence: [
          { kind: "reconciliation", summary: "exact operation completed" },
          { kind: "acceptance", summary: "acceptance checks passed" },
        ],
        recoveryRequired: false,
      },
      testExecutor,
    );
    await context.cluster.database.configuration.create({
      data: { id: "config/2", content: { mode: "next" } },
    });
    await context.cluster.database.environment.update({
      where: { id: context.fixture.environment.id },
      data: { declaredConfigurationId: "config/2" },
    });
    const next = await context.delivery.createDeployment(
      { ...context.input("next"), expectedGeneration: 1 },
      testOperator,
    );
    expect(next.previousAcceptedVersionSetRevisionId).toBe(
      context.fixture.versionSet.id,
    );
    expect(next.previousAcceptedDeploymentId).toBe(first.id);
    const snapshot = await context.delivery.detail(next.id);
    expect(snapshot.previousAcceptedVersionSet?.id).toBe(
      context.fixture.versionSet.id,
    );
    expect(snapshot.configuration).toMatchObject({
      id: "config/2",
      content: { mode: "next" },
    });
  });
  test("Scout production approval is human-only and bound to the frozen generation", async () => {
    const build = await context.delivery.publish(
      {
        ...testPublication(5),
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
    await context.delivery.qualify(build.buildId, "verified", testExecutor);
    const revisions = await context.delivery.versions("scout-for-lol");
    const selected = revisions[0];
    if (selected === undefined) throw new Error("Scout version set missing");
    await context.delivery.registerPipeline(
      "scout-pipeline",
      { kind: "manual", reason: "Approval boundary test" },
      testOperator,
    );
    await context.delivery.registerEnvironment(
      {
        id: "scout/prod",
        serviceId: "scout-for-lol",
        name: "prod",
        application: "scout-prod",
        pipelineRevisionId: "scout-pipeline",
        configurationRevision: "config/1",
        configuration: {},
        automatic: true,
        approvalPolicy: "required",
      },
      testOperator,
    );
    const deployment = await context.delivery.createDeployment(
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
    expect(await context.cluster.database.outbox.count()).toBe(0);
    await expect(
      context.delivery.approve(
        deployment.id,
        { decision: "approve", reason: "not a human" },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await context.cluster.database.environment.update({
      where: { id: "scout/prod" },
      data: { generation: { increment: 1 } },
    });
    // A stale binding generation expires the approval and fails the request (H2).
    const expired = await context.delivery.approve(
      deployment.id,
      { decision: "approve", reason: "reviewed exact inputs" },
      testOperator,
    );
    expect(expired.status).toBe("failed");
    expect(
      await context.cluster.database.approval.findUniqueOrThrow({
        where: { deploymentId: deployment.id },
      }),
    ).toMatchObject({ status: "expired", actor: null });
    expect(await context.cluster.database.outbox.count()).toBe(0);
  });
  test("environment configuration cannot change while a deployment is pending or active", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    const registration = {
      id: context.fixture.environment.id,
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/1",
      configurationRevision: "config/2",
      configuration: { changed: "yes" },
      automatic: true,
    };
    await expect(
      context.delivery.registerEnvironment(registration, testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await context.delivery.claim(deployment.id, testExecutor);
    await expect(
      context.delivery.registerEnvironment(registration, testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
