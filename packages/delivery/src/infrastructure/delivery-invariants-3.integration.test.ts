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
describe("PostgreSQL delivery invariants 3.1", () => {
  test("claim racing queued cancellation never resurrects a canceled request", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await Promise.allSettled([
      delivery.claim(deployment.id, testExecutor),
      delivery.cancel(deployment.id, testOperator),
    ]);
    const stored = await delivery.detail(deployment.id);
    expect(stored.deployment.cancelRequested).toBe(true);
    if (stored.deployment.status === "canceled") {
      expect(stored.environment.activeDeploymentId).toBeNull();
      expect(await cluster.database.applicationLock.count()).toBe(0);
    } else {
      expect(stored.deployment.status).toBe("running");
      expect(stored.environment.activeDeploymentId).toBe(deployment.id);
    }
  });
  test("terminal results reject changed evidence even when status and message match", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await delivery.claim(deployment.id, testExecutor);
    const result = {
      status: "failed" as const,
      message: "preflight failed",
      recoveryRequired: false,
      evidence: [
        { kind: "preflight" as const, summary: "selectors incompatible" },
      ],
    };
    await delivery.finish(deployment.id, result, testExecutor);
    const duplicate = await delivery.finish(
      deployment.id,
      result,
      testExecutor,
    );
    expect(duplicate.id).toBe(deployment.id);
    await expect(
      delivery.finish(deployment.id, { ...result, evidence: [] }, testExecutor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("incompatible artifact requirements fail release qualification without exposing eligible versions", async () => {
    const build = await delivery.publish(
      {
        ...publication(2),
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
      await delivery.qualify(build.buildId, "verified", testExecutor),
    ).toEqual({ status: "failed" });
    const overview = await delivery.overview();
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
    const first = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    const selected = first.deployments[0];
    if (selected === undefined) throw new Error("Automatic selection missing");
    await delivery.cancel(selected, testOperator);
    expect(
      await delivery.reconcile([fixture.environment.id], testExecutor),
    ).toEqual({ deployments: [] });
    const build = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    await delivery.qualify(build.buildId, "verified", testExecutor);
    expect(
      await delivery.reconcile([fixture.environment.id], testExecutor),
    ).toMatchObject({ deployments: [expect.any(String)] });
  });
});
describe("PostgreSQL delivery invariants 3.2", () => {
  test("newer eligible versions supersede only unstarted automatic requests", async () => {
    const first = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    const oldId = first.deployments[0];
    if (oldId === undefined) throw new Error("Automatic selection missing");
    const build = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    await delivery.qualify(build.buildId, "verified", testExecutor);
    const second = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    const old = await delivery.detail(oldId);
    expect(old.deployment.status).toBe("canceled");
    expect(old.deployment.message).toContain("Superseded before execution");
    expect(second.deployments).toHaveLength(1);
    expect(await cluster.database.outbox.count()).toBe(1);
  });
  test("automatic selection preserves a manually selected queued deployment", async () => {
    const manual = await delivery.createDeployment(input(), testOperator);
    const build = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    await delivery.qualify(build.buildId, "verified", testExecutor);
    expect(
      await delivery.reconcile([fixture.environment.id], testExecutor),
    ).toEqual({ deployments: [] });
    const preserved = await delivery.detail(manual.id);
    expect(preserved.deployment.status).toBe("queued");
  });
  test("closed workflow orphan recovery retains only ambiguous external mutation ownership", async () => {
    const queued = await delivery.createDeployment(input(), testOperator);
    await delivery.submitted(queued.id, `delivery/${queued.id}`);
    expect(await delivery.monitor()).toMatchObject({
      deployments: [{ id: queued.id }],
    });
    await delivery.orphan(
      queued.id,
      {
        workflowId: `delivery/${queued.id}`,
        workflowStatus: "FAILED",
        reason: "Worker failed before claim",
      },
      testExecutor,
    );
    const clean = await delivery.detail(queued.id);
    expect(clean.deployment.status).toBe("failed");
    expect(clean.deployment.recoveryRequired).toBe(false);
    const running = await delivery.createDeployment(
      input("orphan-running"),
      testOperator,
    );
    await delivery.claim(running.id, testExecutor);
    await delivery.stage(
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
    await delivery.orphan(
      running.id,
      {
        workflowId: `delivery/${running.id}`,
        workflowStatus: "TIMED_OUT",
        reason: "Workflow ended during external mutation",
      },
      testExecutor,
    );
    const ambiguous = await delivery.detail(running.id);
    expect(ambiguous.deployment.recoveryRequired).toBe(true);
    expect(ambiguous.environment.activeDeploymentId).toBe(running.id);
  });
  test("worker registration refuses activation without retained-version host management", async () => {
    await expect(
      delivery.registerPipeline(
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
    expect(await cluster.database.pipeline.count()).toBe(1);
  });
});
