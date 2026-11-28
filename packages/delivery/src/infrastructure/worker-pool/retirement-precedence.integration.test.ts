import { expect, test } from "vitest";
import { composeVerifiedBuild } from "#infrastructure/composition/verified-build.ts";
import { lock } from "#infrastructure/delivery-records.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { freshWorkerProof } from "#testing/worker-fixture.ts";
import { workerPoolSuite } from "#testing/worker-pool-suite.ts";
import { AUTO_RETIRE_ACTOR } from "./auto-retirement.ts";

const suite = workerPoolSuite();
const evidence = [
  { kind: "reconciliation" as const, summary: "Exact target applied" },
  { kind: "acceptance" as const, summary: "Exact target verified" },
];

async function automaticWorkerPool() {
  const { fixture, delivery } = suite;
  const db = suite.cluster.database;
  const original = await fixture.acceptedRelease(1);
  const accepted = await fixture.acceptedRelease(2);
  await fixture.frozenRecipe(accepted.deployment.id);
  const env = await db.environment.update({
    where: { id: fixture.environmentId },
    data: { automatic: true, pipelineRevisionId: fixture.workerPipeline.id },
  });
  const baseline = await delivery.createDeployment(
    {
      requestId: "resolve-existing-worker-baseline",
      environmentId: env.id,
      versionSetRevisionId: accepted.version.id,
      expectedGeneration: env.generation,
      kind: "adopt-worker",
      workerBaseline: {
        artifactIds: [original.artifactId, accepted.artifactId],
        candidateArtifactId: accepted.artifactId,
      },
    },
    testOperator,
  );
  await delivery.claim(baseline.id, testExecutor);
  for (const key of [
    "worker-image-provenance",
    "worker-prior-source",
    "worker-baseline",
  ])
    await delivery.stage(
      baseline.id,
      {
        key,
        operationId: deliveryOperationId(`${baseline.id}:${key}`),
        status: "succeeded",
        message: "Independent adapter observation fixture",
        evidence,
      },
      testExecutor,
    );
  await delivery.finish(
    baseline.id,
    {
      status: "succeeded",
      message: "Accepted host baseline",
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
  const snapshot = await fixture.freeze(accepted);
  const host = snapshot.versions.find(
    (worker) => worker.artifactId === original.artifactId,
  );
  if (host === undefined) throw new Error("Missing retained host");
  return {
    env,
    accepted,
    host,
    currentBuildId: snapshot.candidateBuildId,
    retirementInput: {
      expectedEnvironmentGeneration: env.generation,
      expectedWorkerGeneration: host.generation,
    },
    reconcile: async () => {
      const result = await delivery.reconcile([env.id], testExecutor);
      return result.deployments;
    },
  };
}

async function finishRelease(deploymentId: string, versionSetId: string) {
  await suite.delivery.finish(
    deploymentId,
    {
      status: "succeeded",
      message: "Accepted worker release",
      observedRevisionId: versionSetId,
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
}

test.each(["legacy", "generation-scoped"] as const)(
  "a newer release takes a %s auto-retirement's queued slot and preserves its exact replay",
  async (requestFormat) => {
    const { delivery, fixture } = suite;
    const db = suite.cluster.database;
    const pool = await automaticWorkerPool();
    const { env, host, retirementInput, reconcile, accepted } = pool;
    const legacyRequestId = `auto-retire-${host.id}-${host.generation.toString()}`;
    const retirement =
      requestFormat === "legacy"
        ? await delivery.retireWorker(
            host.id,
            { requestId: legacyRequestId, ...retirementInput },
            AUTO_RETIRE_ACTOR,
          )
        : await delivery.autoRetireWorker(
            host.id,
            retirementInput,
            testExecutor,
          );
    expect(
      await delivery.autoRetireWorker(host.id, retirementInput, testExecutor),
    ).toEqual(retirement);
    const next = await fixture.publishRelease(3);
    const [releaseId] = await reconcile();
    if (releaseId === undefined)
      throw new Error("New worker release did not replace the retirement");
    expect(await reconcile()).toEqual([]);
    const previous = await delivery.detail(retirement.id);
    expect(previous.deployment).toMatchObject({
      status: "canceled",
      startedAt: null,
      recoveryRequired: false,
      versionSetRevisionId: accepted.version.id,
      workerSnapshot: retirement.workerSnapshot,
    });
    expect(
      await db.outbox.count({ where: { deploymentId: retirement.id } }),
    ).toBe(0);
    expect(
      await db.audit.count({
        where: { action: "deployment.superseded", entityId: retirement.id },
      }),
    ).toBe(1);
    await expect(
      delivery.claim(
        retirement.id,
        testExecutor,
        freshWorkerProof(host, pool.currentBuildId),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await delivery.autoRetireWorker(host.id, retirementInput, testExecutor),
    ).toEqual(previous.deployment);
    const whilePending = await delivery.retirementCandidates(testExecutor);
    expect(whilePending.environments).toEqual([]);

    const claimed = await delivery.claim(releaseId, testExecutor);
    expect(claimed.deployment).toMatchObject({
      status: "running",
      automatic: true,
      versionSetRevisionId: next.version.id,
    });
    await finishRelease(releaseId, next.version.id);
    const { environments } = await delivery.retirementCandidates(testExecutor);
    expect(environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentId: env.id,
          workers: expect.arrayContaining([
            expect.objectContaining({
              id: host.id,
              generation: host.generation,
            }),
          ]),
        }),
      ]),
    );
    const current = await delivery.workers(env.id, testOperator);
    const nextInput = {
      ...retirementInput,
      expectedEnvironmentGeneration: current.generation,
    };
    const offeredAgain = await delivery.autoRetireWorker(
      host.id,
      nextInput,
      testExecutor,
    );
    expect(offeredAgain.id).not.toBe(retirement.id);
    expect(offeredAgain).toMatchObject({
      status: "queued",
      versionSetRevisionId: next.version.id,
    });
    expect(
      await delivery.autoRetireWorker(host.id, nextInput, testExecutor),
    ).toEqual(offeredAgain);
    expect(
      await delivery.autoRetireWorker(host.id, retirementInput, testExecutor),
    ).toEqual(previous.deployment);
    await expect(
      delivery.claim(offeredAgain.id, testExecutor),
    ).rejects.toMatchObject({ code: "INVALID" });
    const candidate = claimed.deployment.workerSnapshot?.candidateBuildId;
    if (candidate === undefined)
      throw new Error("Missing accepted worker candidate");
    const guarded = await delivery.claim(
      offeredAgain.id,
      testExecutor,
      freshWorkerProof(host, candidate),
    );
    expect(guarded.deployment.status).toBe("running");
    await delivery.finish(
      offeredAgain.id,
      {
        status: "failed",
        message: "Fresh drain proof expired before retirement",
        recoveryRequired: false,
        evidence: [],
      },
      testExecutor,
    );
    expect(
      await delivery.autoRetireWorker(host.id, retirementInput, testExecutor),
    ).toEqual(previous.deployment);
    await expect(
      delivery.autoRetireWorker(host.id, nextInput, testExecutor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);

test.each(["manual", "approved"] as const)(
  "a newer release preserves a %s retirement",
  async (mode) => {
    const { delivery, fixture } = suite;
    const { env, host, retirementInput, reconcile } =
      await automaticWorkerPool();
    if (mode === "approved") {
      await suite.cluster.database.environment.update({
        where: { id: env.id },
        data: { approvalPolicy: "required" },
      });
    }
    const retirement =
      mode === "manual"
        ? await delivery.retireWorker(
            host.id,
            { requestId: "operator-retirement", ...retirementInput },
            testOperator,
          )
        : await delivery.autoRetireWorker(
            host.id,
            retirementInput,
            testExecutor,
          );
    if (mode === "approved")
      await delivery.approve(
        retirement.id,
        { decision: "approve", reason: "Exact retirement reviewed" },
        testOperator,
      );
    await fixture.publishRelease(3);
    expect(await reconcile()).toEqual([]);
    const detail = await delivery.detail(retirement.id);
    expect(detail.deployment.status).toBe("queued");
    expect(detail.approval?.status).toBe(
      mode === "approved" ? "granted" : undefined,
    );
  },
);

test("a claimed or recovery-required auto-retirement keeps ownership", async () => {
  const { delivery, fixture } = suite;
  const { env, host, currentBuildId, retirementInput, reconcile } =
    await automaticWorkerPool();
  const retirement = await delivery.autoRetireWorker(
    host.id,
    retirementInput,
    testExecutor,
  );
  await delivery.claim(
    retirement.id,
    testExecutor,
    freshWorkerProof(host, currentBuildId),
  );
  await fixture.publishRelease(3);
  expect(await reconcile()).toEqual([]);
  await delivery.finish(
    retirement.id,
    {
      status: "failed",
      message: "Native ownership must be recovered",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  expect(await reconcile()).toEqual([]);
  const detail = await delivery.detail(retirement.id);
  expect(detail.environment).toMatchObject({
    id: env.id,
    activeDeploymentId: retirement.id,
  });
  expect(detail.deployment.recoveryRequired).toBe(true);
});

test("a concurrent claim and replacement cannot both own the retirement slot", async () => {
  const { delivery, fixture } = suite;
  const { host, currentBuildId, retirementInput, reconcile } =
    await automaticWorkerPool();
  const retirement = await delivery.autoRetireWorker(
    host.id,
    retirementInput,
    testExecutor,
  );
  await fixture.publishRelease(3);
  const [claim, replacement] = await Promise.allSettled([
    delivery.claim(
      retirement.id,
      testExecutor,
      freshWorkerProof(host, currentBuildId),
    ),
    reconcile(),
  ]);
  const { deployment, environment } = await delivery.detail(retirement.id);
  if (claim.status === "fulfilled") {
    expect(deployment.status).toBe("running");
    expect(environment.activeDeploymentId).toBe(retirement.id);
    expect(replacement).toEqual({ status: "fulfilled", value: [] });
  } else {
    expect(claim.reason).toMatchObject({ code: "CONFLICT" });
    expect(deployment).toMatchObject({ status: "canceled", startedAt: null });
    expect(replacement).toEqual({
      status: "fulfilled",
      value: [expect.any(String)],
    });
    expect(environment.activeDeploymentId).toBeNull();
  }
});

test("a stale replacement waits for an in-flight CI composition and leaves the queued retirement intact", async () => {
  const { delivery, fixture } = suite;
  const db = suite.cluster.database;
  const { env, host, retirementInput, reconcile } = await automaticWorkerPool();
  const retirement = await delivery.autoRetireWorker(
    host.id,
    retirementInput,
    testExecutor,
  );
  const planned = await fixture.publishRelease(3);
  const next = await delivery.publish(
    {
      requestId: "qualifying-newer-worker",
      serviceId: env.serviceId,
      sourceRevision: "4".padEnd(40, "0"),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/4",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "newer/temporal-worker",
          component: "image:temporal-worker",
          kind: "image",
          uri: "docker.io/shepherdjerred/temporal-worker",
          digest: `sha256:${"4".padStart(64, "0")}`,
          version: "build-4",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 4 },
  );
  const lockKey = `versionSet:${env.serviceId}`;
  const ready = Promise.withResolvers<undefined>();
  const commit = Promise.withResolvers<undefined>();
  const composition = db.$transaction(
    async (tx) => {
      await lock(tx, `qualification:${env.serviceId}`);
      const verified = await tx.build.update({
        where: { id: next.buildId },
        data: { status: "verified" },
      });
      const set = await composeVerifiedBuild(tx, verified);
      if (set === null) throw new Error("New CI set did not compose");
      ready.resolve(undefined);
      await commit.promise;
      return set.id;
    },
    { timeout: 10_000 },
  );
  await Promise.race([ready.promise, composition]);
  const attempting = Promise.allSettled([
    delivery.createDeployment(
      {
        requestId: "stale-direct-replacement",
        environmentId: env.id,
        versionSetRevisionId: planned.version.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testExecutor,
      { retirementId: retirement.id, versionSetId: planned.version.id },
    ),
  ]);
  try {
    await expect
      .poll(async () => {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
            AND objid = hashtext(${lockKey})::oid
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        ) AS "waiting"
      `;
        return rows[0]?.waiting;
      })
      .toBe(true);
  } finally {
    commit.resolve(undefined);
  }
  const newestId = await composition;
  expect(await attempting).toEqual([
    {
      status: "rejected",
      reason: expect.objectContaining({ code: "CONFLICT" }),
    },
  ]);
  const previous = await delivery.detail(retirement.id);
  expect(previous.deployment.status).toBe("queued");
  const [deploymentId] = await reconcile();
  if (deploymentId === undefined) throw new Error("Missing latest replacement");
  const latest = await delivery.detail(deploymentId);
  expect(latest.deployment.versionSetRevisionId).toBe(newestId);
});

test("a delayed promotion cannot replace a retirement under the previous source selection's request ID", async () => {
  const { delivery, fixture } = suite;
  const db = suite.cluster.database;
  const { env, host, retirementInput, reconcile } = await automaticWorkerPool();
  const sourceId = "temporal/selection-source";
  const source = await db.environment.create({
    data: {
      id: sourceId,
      serviceId: env.serviceId,
      name: "selection-source",
      application: "temporal-selection-source",
      pipelineRevisionId: "central/persistence-fixture/1",
      declaredConfigurationId: env.declaredConfigurationId,
    },
  });
  const retirement = await delivery.autoRetireWorker(
    host.id,
    retirementInput,
    testExecutor,
  );
  await db.environment.update({
    where: { id: env.id },
    data: { promotionSourceEnvironmentId: source.id },
  });
  const planned = await fixture.publishRelease(3);
  const newest = await fixture.publishRelease(4);
  for (const [offset, candidate] of [planned, newest].entries()) {
    const requested = await delivery.createDeployment(
      {
        requestId: `fixture-source/${candidate.version.id}`,
        environmentId: source.id,
        versionSetRevisionId: candidate.version.id,
        expectedGeneration: source.generation + offset,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(requested.id, testExecutor);
    await finishRelease(requested.id, candidate.version.id);
  }

  const staleRequestId = `automatic/${env.id}/${planned.version.id}/source-changed`;
  await expect(
    delivery.createDeployment(
      {
        requestId: staleRequestId,
        environmentId: env.id,
        sourceEnvironmentId: source.id,
        expectedGeneration: env.generation,
        kind: "promote",
      },
      testExecutor,
      { retirementId: retirement.id, versionSetId: planned.version.id },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const previous = await delivery.detail(retirement.id);
  expect(previous.deployment.status).toBe("queued");
  const [replacement] = await reconcile();
  if (replacement === undefined) throw new Error("Missing new promotion");
  const latest = await delivery.detail(replacement);
  expect(latest.deployment).toMatchObject({
    versionSetRevisionId: newest.version.id,
    requestId: expect.stringContaining(`/${newest.version.id}/`),
  });
  expect(
    await db.request.findUnique({ where: { id: staleRequestId } }),
  ).toBeNull();
});

test("a pending automated retirement does not revive a failed release", async () => {
  const { delivery, fixture } = suite;
  const { host, retirementInput, reconcile } = await automaticWorkerPool();
  await fixture.publishRelease(3);
  const [failed] = await reconcile();
  if (failed === undefined) throw new Error("Missing automatic release");
  await delivery.claim(failed, testExecutor);
  await delivery.finish(
    failed,
    {
      status: "failed",
      message: "Exact release refused",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  const retirement = await delivery.autoRetireWorker(
    host.id,
    retirementInput,
    testExecutor,
  );
  expect(await reconcile()).toEqual([]);
  const detail = await delivery.detail(retirement.id);
  expect(detail.deployment.status).toBe("queued");
});

test.each(["operator-canceled", "superseded"] as const)(
  "a %s retirement stays deferred without a qualifying change in acceptance",
  async (reason) => {
    const { delivery, fixture } = suite;
    const { env, host, retirementInput, reconcile } =
      await automaticWorkerPool();
    const retirement = await delivery.autoRetireWorker(
      host.id,
      retirementInput,
      testExecutor,
    );
    if (reason === "operator-canceled")
      await delivery.cancel(retirement.id, testOperator);
    const next = await fixture.publishRelease(3);
    const [releaseId] = await reconcile();
    if (releaseId === undefined) throw new Error("Missing automatic release");
    await delivery.claim(releaseId, testExecutor);
    if (reason === "superseded") {
      await delivery.finish(
        releaseId,
        {
          status: "failed",
          message: "Replacement did not accept",
          recoveryRequired: false,
          evidence: [],
        },
        testExecutor,
      );
      const replay = await delivery.autoRetireWorker(
        host.id,
        retirementInput,
        testExecutor,
      );
      expect(replay).toMatchObject({ id: retirement.id, status: "canceled" });
    } else {
      await finishRelease(releaseId, next.version.id);
      const current = await delivery.workers(env.id, testOperator);
      await expect(
        delivery.autoRetireWorker(
          host.id,
          {
            ...retirementInput,
            expectedEnvironmentGeneration: current.generation,
          },
          testExecutor,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    const { environments } = await delivery.retirementCandidates(testExecutor);
    const offered = environments.flatMap(({ workers }) =>
      workers.map(({ id }) => id),
    );
    expect(offered).not.toContain(host.id);
  },
);
