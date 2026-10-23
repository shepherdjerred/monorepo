import { describe, expect, test } from "vitest";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import {
  useDeliveryFixture,
  testPublication,
} from "#testing/delivery-fixture.ts";

const context = useDeliveryFixture();
describe("PostgreSQL delivery invariants 3.1", () => {
  test("claim racing queued cancellation never resurrects a canceled request", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await Promise.allSettled([
      context.delivery.claim(deployment.id, testExecutor),
      context.delivery.cancel(deployment.id, testOperator),
    ]);
    const stored = await context.delivery.detail(deployment.id);
    expect(stored.deployment.cancelRequested).toBe(true);
    if (stored.deployment.status === "canceled") {
      expect(stored.environment.activeDeploymentId).toBeNull();
      expect(await context.cluster.database.targetLock.count()).toBe(0);
    } else {
      expect(stored.deployment.status).toBe("running");
      expect(stored.environment.activeDeploymentId).toBe(deployment.id);
    }
  });
  test("terminal results reject changed evidence even when status and message match", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.claim(deployment.id, testExecutor);
    const result = {
      status: "failed" as const,
      message: "preflight failed",
      recoveryRequired: false,
      evidence: [
        { kind: "preflight" as const, summary: "selectors incompatible" },
      ],
    };
    await context.delivery.finish(deployment.id, result, testExecutor);
    const duplicate = await context.delivery.finish(
      deployment.id,
      result,
      testExecutor,
    );
    expect(duplicate.id).toBe(deployment.id);
    await expect(
      context.delivery.finish(
        deployment.id,
        { ...result, evidence: [] },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("incompatible artifact requirements fail release qualification without exposing eligible versions", async () => {
    const build = await context.delivery.publish(
      {
        ...testPublication(2),
        artifacts: [
          {
            id: "site/incompatible",
            component: "site",
            kind: "archive",
            uri: "s3://delivery-artifacts/sites/arcade/fixture.tar",
            digest: `sha256:${"f".repeat(64)}`,
            version: "build-2",
            requires: { server: `sha256:${"c".repeat(64)}` },
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 2 },
    );
    expect(
      await context.delivery.qualify(build.buildId, "verified", testExecutor),
    ).toEqual({ status: "failed" });
    const overview = await context.delivery.overview();
    expect(overview.versionSets).toHaveLength(1);
    expect(
      overview.artifacts.some((entry) => entry.id === "site/incompatible"),
    ).toBe(false);
    expect(
      overview.builds.find((entry) => entry.id === build.buildId)
        ?.qualificationReason,
    ).toContain("requires exact server");
  });
  test("canceling an automatic selection suppresses that revision until a new version arrives", async () => {
    const first = await context.delivery.reconcile(
      [context.fixture.environment.id],
      testExecutor,
    );
    const selected = first.deployments[0];
    if (selected === undefined) throw new Error("Automatic selection missing");
    await context.delivery.cancel(selected, testOperator);
    expect(
      await context.delivery.reconcile(
        [context.fixture.environment.id],
        testExecutor,
      ),
    ).toEqual({ deployments: [] });
    await context.publishVerified(2);
    expect(
      await context.delivery.reconcile(
        [context.fixture.environment.id],
        testExecutor,
      ),
    ).toMatchObject({ deployments: [expect.any(String)] });
  });
});
describe("PostgreSQL delivery invariants 3.2", () => {
  test("newer eligible versions supersede only unstarted automatic requests", async () => {
    const first = await context.delivery.reconcile(
      [context.fixture.environment.id],
      testExecutor,
    );
    const oldId = first.deployments[0];
    if (oldId === undefined) throw new Error("Automatic selection missing");
    await context.publishVerified(2);
    const second = await context.delivery.reconcile(
      [context.fixture.environment.id],
      testExecutor,
    );
    const old = await context.delivery.detail(oldId);
    expect(old.deployment.status).toBe("canceled");
    expect(old.deployment.message).toContain("Superseded before execution");
    expect(second.deployments).toHaveLength(1);
    expect(await context.cluster.database.outbox.count()).toBe(1);
  });
  test("automatic selection preserves a manually selected queued deployment", async () => {
    const manual = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.publishVerified(2);
    expect(
      await context.delivery.reconcile(
        [context.fixture.environment.id],
        testExecutor,
      ),
    ).toEqual({ deployments: [] });
    const preserved = await context.delivery.detail(manual.id);
    expect(preserved.deployment.status).toBe("queued");
  });
  test("closed workflow orphan recovery retains only ambiguous external mutation ownership", async () => {
    const queued = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.submitted(queued.id, `delivery/${queued.id}`);
    expect(await context.delivery.monitor()).toMatchObject({
      deployments: [{ id: queued.id }],
    });
    await context.delivery.orphan(
      queued.id,
      {
        workflowId: `delivery/${queued.id}`,
        workflowStatus: "FAILED",
        reason: "Worker failed before claim",
      },
      testExecutor,
    );
    const clean = await context.delivery.detail(queued.id);
    expect(clean.deployment.status).toBe("failed");
    expect(clean.deployment.recoveryRequired).toBe(false);
    const running = await context.delivery.createDeployment(
      context.input("orphan-running"),
      testOperator,
    );
    await context.delivery.claim(running.id, testExecutor);
    await context.delivery.stage(
      running.id,
      {
        key: "reconcile",
        status: "running",
        operationId: "op/orphan",
        message: "Mutation submitted",
        evidence: [],
      },
      testExecutor,
    );
    await context.delivery.orphan(
      running.id,
      {
        workflowId: `delivery/${running.id}`,
        workflowStatus: "TIMED_OUT",
        reason: "Workflow ended during external mutation",
      },
      testExecutor,
    );
    const ambiguous = await context.delivery.detail(running.id);
    expect(ambiguous.deployment.recoveryRequired).toBe(true);
    expect(ambiguous.environment.activeDeploymentId).toBe(running.id);
  });
  test("worker registration refuses activation without retained-version host management", async () => {
    await expect(
      context.delivery.registerPipeline(
        "unsupported-workers",
        {
          kind: "argocd",
          application: "arcade",
          chartRepository: "https://chartmuseum.sjer.red",
          chartName: "arcade",
          chartComponent: "chart",
          parameters: {},
          artifactParameters: {},
          workerRollout: {
            target: "central",
            imageComponent: "server",
            runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
          },
        },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await context.cluster.database.pipeline.count()).toBe(1);
  });
});
