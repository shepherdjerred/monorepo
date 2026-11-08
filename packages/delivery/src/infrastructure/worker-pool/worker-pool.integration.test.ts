import { expect, test } from "vitest";
import { freshWorkerProof } from "#testing/worker-fixture.ts";
import { workerPoolSuite } from "#testing/worker-pool-suite.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { freezeWorkerSnapshot } from "./pool.ts";
import {
  WorkerPoolSnapshotSchema,
  WorkerHostSpecificationSchema,
  WorkerRetirementClaimSchema,
} from "#shared/contract.ts";

const suite = workerPoolSuite();
async function baseline() {
  return suite.fixture.acceptedPool();
}

test("fixed worker profiles retain immutable original artifacts and both central namespaces", async () => {
  const { a, workerA } = await baseline();
  expect(workerA).toMatchObject({
    artifactId: a.artifactId,
    introducedByDeploymentId: a.deployment.id,
    buildId: "1".padEnd(40, "0"),
    replicas: 1,
    runtimeDigests: [`sha256:${"e".repeat(64)}`],
  });
  expect(workerA.host.routes.map((route) => route.namespace)).toEqual([
    "prod",
    "beta",
  ]);
  expect(
    WorkerHostSpecificationSchema.safeParse({
      ...workerA.host,
      command: ["arbitrary-command"],
    }).success,
  ).toBe(false);
  await expect(
    suite.delivery.registerWorker(
      {
        requestId: "wrong-profile",
        environmentId: suite.fixture.environmentId,
        expectedGeneration: 4,
        artifactId: a.artifactId,
        introducedByDeploymentId: a.deployment.id,
        target: "scout-prod",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  const view = await suite.delivery.workers(suite.fixture.environmentId, {
    id: "reader",
    kind: "human",
    scopes: ["read"],
  });
  expect(view.versions).toHaveLength(2);
});

test("pool registration uses environment CAS and does not duplicate a concurrent request", async () => {
  const a = await suite.fixture.acceptedRelease(1);
  const env = await suite.cluster.database.environment.findUniqueOrThrow({
    where: { id: suite.fixture.environmentId },
  });
  const input = {
    requestId: "same-adoption",
    environmentId: env.id,
    expectedGeneration: env.generation,
    artifactId: a.artifactId,
    introducedByDeploymentId: a.deployment.id,
    target: "central" as const,
  };
  const [first, repeated] = await Promise.all([
    suite.delivery.registerWorker(input, testOperator),
    suite.delivery.registerWorker(input, testOperator),
  ]);
  expect(first).toEqual(repeated);
  expect(await suite.cluster.database.workerVersion.count()).toBe(1);
  await expect(
    suite.delivery.registerWorker(
      { ...input, requestId: "stale-adoption" },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("rollback freezes the accepted candidate plus newer live hosts without changing original identities", async () => {
  const { a, workerA, workerB, snapshotA } = await baseline();
  const c = await suite.fixture.acceptedRelease(3);
  const workerC = await suite.fixture.adopt(c);
  const detail = await suite.delivery.detail(a.deployment.id);
  const frozen = await suite.cluster.database.$transaction((tx) =>
    freezeWorkerSnapshot(tx, {
      environment: detail.environment,
      pipeline: suite.fixture.workerPipeline,
      versionSet: detail.versionSet,
      deploymentId: "rollback/frozen",
      restored: { deploymentId: a.deployment.id, snapshot: snapshotA },
    }),
  );
  expect(frozen?.candidateBuildId).toBe(workerA.buildId);
  expect(frozen?.restoredFromDeploymentId).toBe(a.deployment.id);
  expect(frozen?.versions.find((row) => row.id === workerA.id)).toEqual(
    snapshotA.versions.find((row) => row.id === workerA.id),
  );
  expect(
    frozen?.versions
      .filter((row) => row.replicas === 1)
      .map((row) => row.id)
      .toSorted(),
  ).toEqual([workerA.id, workerB.id, workerC.id].toSorted());
  const stored = await suite.cluster.database.deployment.findUniqueOrThrow({
    where: { id: a.deployment.id },
  });
  expect(WorkerPoolSnapshotSchema.parse(stored.workerSnapshot)).toEqual(
    snapshotA,
  );
});

test("retirement holds ownership, refreshes proof on repeated claim, and commits zero only on accepted execution", async () => {
  const { workerA, workerB, env } = await baseline();
  const proof = freshWorkerProof(workerA, workerB.buildId);
  const input = {
    requestId: "retire/a",
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const selected = await suite.delivery.retireWorker(
    workerA.id,
    input,
    testOperator,
  );
  expect(selected.kind).toBe("retire-host");
  expect(selected.workerSnapshot?.candidateBuildId).toBe(workerB.buildId);
  expect(
    selected.workerSnapshot?.versions.find((row) => row.id === workerA.id)
      ?.replicas,
  ).toBe(0);
  const beforeAcceptance =
    await suite.cluster.database.workerVersion.findUniqueOrThrow({
      where: { id: workerA.id },
    });
  expect(beforeAcceptance.replicas).toBe(1);
  expect(
    await suite.delivery.retireWorker(workerA.id, input, testOperator),
  ).toEqual(selected);
  await expect(
    suite.delivery.retireWorker(
      workerA.id,
      { ...input, expectedWorkerGeneration: 99 },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    suite.delivery.claim(selected.id, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
  await suite.delivery.claim(selected.id, testExecutor, proof);
  await expect(
    suite.delivery.claim(
      selected.id,
      testExecutor,
      freshWorkerProof(workerA, workerB.buildId, Date.now() - 120_000),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await suite.delivery.claim(
    selected.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  expect(
    await suite.cluster.database.targetLock.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(1);
  const result = {
    status: "succeeded" as const,
    message: "Accepted scale zero fixture",
    recoveryRequired: false,
    observedRevisionId: selected.versionSetRevisionId,
    evidence: [
      { kind: "reconciliation" as const, summary: "Exact frozen pool applied" },
      { kind: "acceptance" as const, summary: "Retired host absent" },
    ],
  };
  await suite.delivery.finish(selected.id, result, testExecutor);
  await suite.delivery.finish(selected.id, result, testExecutor);
  const retired = await suite.cluster.database.workerVersion.findUniqueOrThrow({
    where: { id: workerA.id },
  });
  expect(retired).toMatchObject({
    replicas: 0,
    generation: 1,
    artifactId: workerA.artifactId,
  });
  expect(retired.retirementProof).toMatchObject({ deploymentId: selected.id });
  expect(await suite.cluster.database.workerVersion.count()).toBe(2);
  expect(await suite.cluster.database.targetLock.count()).toBe(0);
});

test("rollback never replaces a currently live retained host with a historical zero", async () => {
  const { a, workerA, workerB, snapshotA } = await baseline();
  const historical = WorkerPoolSnapshotSchema.parse({
    ...snapshotA,
    versions: [
      workerA,
      { ...workerB, replicas: 0, retiredAt: new Date().toISOString() },
    ],
  });
  const detail = await suite.delivery.detail(a.deployment.id);
  const frozen = await suite.cluster.database.$transaction((tx) =>
    freezeWorkerSnapshot(tx, {
      environment: detail.environment,
      pipeline: suite.fixture.workerPipeline,
      versionSet: detail.versionSet,
      deploymentId: "historical-zero-rollback",
      restored: { deploymentId: a.deployment.id, snapshot: historical },
    }),
  );
  expect(frozen?.versions.find((row) => row.id === workerB.id)).toEqual(
    workerB,
  );
  const changedIdentity = WorkerPoolSnapshotSchema.parse({
    ...snapshotA,
    versions: [{ ...workerA, artifactId: workerB.artifactId }],
  });
  await expect(
    suite.cluster.database.$transaction((tx) =>
      freezeWorkerSnapshot(tx, {
        environment: detail.environment,
        pipeline: suite.fixture.workerPipeline,
        versionSet: detail.versionSet,
        deploymentId: "identity-conflict",
        restored: { deploymentId: a.deployment.id, snapshot: changedIdentity },
      }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("failed ambiguous retirement retains hosts and the Application lock without a desired-zero commit", async () => {
  const { workerA, workerB, env } = await baseline();
  const selected = await suite.delivery.retireWorker(
    workerA.id,
    {
      requestId: "retire-failure",
      expectedEnvironmentGeneration: env.generation,
      expectedWorkerGeneration: workerA.generation,
    },
    testOperator,
  );
  await suite.delivery.claim(
    selected.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  await suite.delivery.finish(
    selected.id,
    {
      status: "failed",
      message: "External response lost",
      recoveryRequired: true,
      evidence: [
        { kind: "runtime", summary: "Owned scale-down remains ambiguous" },
      ],
    },
    testExecutor,
  );
  const retained = await suite.cluster.database.workerVersion.findUniqueOrThrow(
    {
      where: { id: workerA.id },
    },
  );
  expect(retained.replicas).toBe(1);
  expect(retained.generation).toBe(0);
  expect(
    await suite.cluster.database.targetLock.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(1);
  await expect(
    suite.delivery.registerWorker(
      {
        requestId: "change-pool-during-recovery",
        environmentId: env.id,
        expectedGeneration: env.generation + 1,
        artifactId: workerA.artifactId,
        introducedByDeploymentId: workerA.introducedByDeploymentId,
        target: "central",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("retirement rejects incomplete, stale, routed, sticky-drained and referenced versions", async () => {
  const { workerA, workerB, env } = await baseline();
  const proof = freshWorkerProof(workerA, workerB.buildId);
  const input = {
    requestId: "bad-retirement",
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  await expect(
    suite.delivery.retireWorker(workerB.id, input, testOperator),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const selected = await suite.delivery.retireWorker(
    workerA.id,
    input,
    testOperator,
  );
  for (const proofs of [
    proof.proofs.slice(0, 1),
    freshWorkerProof(workerA, workerB.buildId, Date.now() - 120_000).proofs,
    freshWorkerProof(workerA, workerA.buildId).proofs,
    proof.proofs.map((row) => ({
      ...row,
      lastCheckedTime: new Date(Date.now() - 300_000).toISOString(),
    })),
  ])
    await expect(
      suite.delivery.claim(selected.id, testExecutor, { proofs }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID|CONFLICT/u),
    });
  expect(
    await suite.cluster.database.deployment.count({
      where: { kind: "retire-host" },
    }),
  ).toBe(1);
});

test("inactive-unreferenced retirement preserves fresh accepted-pool ownership without inventing drainage", async () => {
  const { workerA, workerB, env } = await baseline();
  const selected = await suite.delivery.retireWorker(
    workerA.id,
    {
      requestId: "inactive/retire",
      expectedEnvironmentGeneration: env.generation,
      expectedWorkerGeneration: workerA.generation,
    },
    testOperator,
  );
  const proof = {
    proofs: freshWorkerProof(workerA, workerB.buildId).proofs.map((row) => ({
      namespace: row.namespace,
      deploymentName: row.deploymentName,
      taskQueue: row.taskQueue,
      observedAt: row.observedAt,
      currentBuildId: row.currentBuildId,
      rampingBuildId: row.rampingBuildId,
      openExecutions: 0 as const,
      routingConflictToken: row.routingConflictToken,
      candidateReferences: 0 as const,
      canaryReferences: 0 as const,
      proofKind: "inactive-unreferenced" as const,
      versionStatus: "INACTIVE" as const,
      versionCreatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      firstActivationTime: null,
      lastCurrentTime: null,
      lastDeactivationTime: null,
      currentSinceTime: null,
      rampingSinceTime: null,
      routingChangedTime: null,
    })),
  };
  for (const { change, error } of [
    {
      change: { observedAt: new Date(Date.now() - 120_000).toISOString() },
      error: { code: "CONFLICT" },
    },
    {
      change: { versionCreatedAt: new Date(Date.now() + 60_000).toISOString() },
      error: { code: "CONFLICT" },
    },
    { change: { versionStatus: "CURRENT" }, error: { name: "ZodError" } },
    {
      change: { lastDeactivationTime: new Date().toISOString() },
      error: { name: "ZodError" },
    },
    {
      change: { currentBuildId: workerA.buildId },
      error: { code: "CONFLICT" },
    },
    {
      change: { rampingBuildId: workerA.buildId },
      error: { code: "CONFLICT" },
    },
    { change: { openExecutions: 1 }, error: { name: "ZodError" } },
    { change: { drainageStatus: "DRAINED" }, error: { name: "ZodError" } },
  ]) {
    const claim = async () =>
      await suite.delivery.claim(
        selected.id,
        testExecutor,
        WorkerRetirementClaimSchema.parse({
          proofs: proof.proofs.map((row) => ({ ...row, ...change })),
        }),
      );
    await expect(claim()).rejects.toMatchObject(error);
  }
  await suite.delivery.claim(selected.id, testExecutor, proof);
  const worker = await suite.cluster.database.workerVersion.findUniqueOrThrow({
    where: { id: workerA.id },
  });
  expect(worker.replicas).toBe(1);
  expect(worker.retirementProof).toMatchObject({
    deploymentId: selected.id,
    proofs: proof.proofs,
  });
  expect(
    await suite.cluster.database.targetLock.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(1);
});

test("Scout production retirement requires exact human approval before fresh executor claim", async () => {
  await suite.useTarget("scout-prod");
  const { workerA, workerB, env } = await baseline();
  const proof = freshWorkerProof(workerA, workerB.buildId);
  const selected = await suite.delivery.retireWorker(
    workerA.id,
    {
      requestId: "scout/retire",
      expectedEnvironmentGeneration: env.generation,
      expectedWorkerGeneration: workerA.generation,
    },
    testOperator,
  );
  expect(selected.status).toBe("awaiting_approval");
  await expect(
    suite.delivery.claim(selected.id, testExecutor, proof),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await suite.delivery.approve(
    selected.id,
    { decision: "approve", reason: "Retire the exact proven old host" },
    testOperator,
  );
  await suite.delivery.claim(
    selected.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  const detail = await suite.delivery.detail(selected.id);
  expect(detail.deployment.workerSnapshot).toEqual(selected.workerSnapshot);
});
