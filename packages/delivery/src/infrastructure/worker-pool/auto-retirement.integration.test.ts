import { expect, test } from "vitest";
import type { WorkerVersion } from "#shared/contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { freshWorkerProof } from "#testing/worker-fixture.ts";
import { workerPoolSuite } from "#testing/worker-pool-suite.ts";
import { publishCiRunner } from "#testing/model-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { AUTO_RETIRE_ACTOR } from "./auto-retirement.ts";

const suite = workerPoolSuite();

test("an idle environment offers its retained, unreferenced hosts but never the accepted candidate", async () => {
  const { workerA, workerB, env } = await suite.fixture.acceptedPool();
  const { environments } =
    await suite.delivery.retirementCandidates(testExecutor);
  expect(environments).toHaveLength(1);
  const [candidates] = environments;
  expect(candidates).toMatchObject({
    environmentId: env.id,
    generation: env.generation,
    workers: [
      {
        id: workerA.id,
        generation: workerA.generation,
        buildId: workerA.buildId,
      },
    ],
  });
  expect(candidates?.pool.candidateBuildId).toBe(workerB.buildId);
  expect(candidates?.pool.versions.map((row) => row.id).toSorted()).toEqual(
    [workerA.id, workerB.id].toSorted(),
  );
});

test("the executor requests a guarded retirement as delivery/auto-retire, once per host generation", async () => {
  const { workerA, env } = await suite.fixture.acceptedPool();
  const input = {
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const requested = await suite.delivery.autoRetireWorker(
    workerA.id,
    input,
    testExecutor,
  );
  expect(requested).toMatchObject({
    kind: "retire-host",
    requestedBy: AUTO_RETIRE_ACTOR.id,
  });
  expect(
    await suite.delivery.autoRetireWorker(workerA.id, input, testExecutor),
  ).toEqual(requested);
  // A pending retirement leaves the environment busy: nothing more is offered.
  const { environments } =
    await suite.delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
});

test("only the executor proposes retirements", async () => {
  const { workerA, env } = await suite.fixture.acceptedPool();
  await expect(
    suite.delivery.retirementCandidates(testOperator),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    suite.delivery.autoRetireWorker(
      workerA.id,
      {
        expectedEnvironmentGeneration: env.generation,
        expectedWorkerGeneration: workerA.generation,
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("a host whose retirement failed is left to an operator", async () => {
  const { workerA, workerB, env } = await suite.fixture.acceptedPool();
  const input = {
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const requested = await suite.delivery.autoRetireWorker(
    workerA.id,
    input,
    testExecutor,
  );
  await suite.delivery.claim(
    requested.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  await suite.delivery.finish(
    requested.id,
    {
      status: "failed",
      message: "Retirement fence refused",
      recoveryRequired: false,
      evidence: [{ kind: "preflight", summary: "Pinned execution appeared" }],
    },
    testExecutor,
  );
  const { environments } =
    await suite.delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
  await expect(
    suite.delivery.autoRetireWorker(
      workerA.id,
      { ...input, expectedWorkerGeneration: workerA.generation },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("an environment whose releases require approval keeps retirement an operator decision", async () => {
  const { env } = await suite.fixture.acceptedPool();
  await suite.cluster.database.environment.update({
    where: { id: env.id },
    data: { approvalPolicy: "required" },
  });
  const { environments } =
    await suite.delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
});

test("an environment that no longer admits releases is never offered", async () => {
  const { env } = await suite.fixture.acceptedPool();
  await suite.cluster.database.environment.update({
    where: { id: env.id },
    data: { lifecycle: "retired" },
  });
  const { environments } =
    await suite.delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
});

/** Retires `worker` through the executor's guarded path; returns the accepted retirement. */
async function retire(worker: WorkerVersion, candidateBuildId: string) {
  const env = await suite.cluster.database.environment.findUniqueOrThrow({
    where: { id: worker.environmentId },
  });
  const requested = await suite.delivery.autoRetireWorker(
    worker.id,
    {
      expectedEnvironmentGeneration: env.generation,
      expectedWorkerGeneration: worker.generation,
    },
    testExecutor,
  );
  await suite.delivery.claim(
    requested.id,
    testExecutor,
    freshWorkerProof(worker, candidateBuildId),
  );
  await suite.delivery.finish(
    requested.id,
    {
      status: "succeeded",
      message: "Retired",
      recoveryRequired: false,
      observedRevisionId: requested.versionSetRevisionId,
      evidence: [
        { kind: "reconciliation", summary: "Exact frozen pool applied" },
        { kind: "acceptance", summary: "Retired host absent" },
      ],
    },
    testExecutor,
  );
  return suite.cluster.database.deployment.findUniqueOrThrow({
    where: { id: requested.id },
  });
}

test("a host retirement keeps the watch of the deployment it follows (W1)", async () => {
  const { workerA, workerB, env } = await suite.fixture.acceptedPool();
  const accepted = await suite.cluster.database.environment.findUniqueOrThrow({
    where: { id: env.id },
  });
  if (accepted.acceptedDeploymentId === null)
    throw new Error("Fixture pool has no accepted deployment");
  const settledAt = new Date("2026-11-10T00:00:00.000Z");
  await suite.cluster.database.deployment.update({
    where: { id: accepted.acceptedDeploymentId },
    data: { monitorState: "settled", monitorSettledAt: settledAt },
  });
  const retired = await retire(workerA, workerB.buildId);
  expect(retired).toMatchObject({
    monitorState: "settled",
    monitorSettledAt: settledAt,
  });
});

const claimedAt = new Date(Date.now() - 60 * 60_000);
const acceptedAt = new Date(claimedAt.getTime() + 5 * 60_000);
/** Active after the original claim, before any retirement's own claim. */
const sinceClaim = new Date(claimedAt.getTime() + 10 * 60_000).toISOString();
const beforeClaim = new Date(claimedAt.getTime() - 60_000).toISOString();

/**
 * Three retained hosts, the newest accepted an hour ago under a recipe that
 * declares a monitor, and still watching.
 */
async function watchingPool() {
  const pool = await suite.fixture.acceptedPool();
  // An Application recipe's retirement admits under the CI runner image.
  await publishCiRunner(suite.delivery);
  const c = await suite.fixture.acceptedRelease(3);
  const workerC = await suite.fixture.adopt(c);
  await suite.fixture.freeze(c);
  const recipe = recipeFromPipeline(suite.fixture.workerPipeline.definition);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("The worker fixture converts to an Application recipe");
  await suite.cluster.database.pipeline.create({
    data: {
      id: "central/monitored-worker-fixture",
      definition: {
        ...recipe,
        oracle: {
          ...recipe.oracle,
          monitor: {
            component: "image:temporal-worker",
            alarms: {
              matchers: { environment: "temporal/prod" },
              severities: ["critical"],
            },
            evidence: [
              {
                key: "workflows",
                query:
                  'sum(increase(temporal_workflow_completed{version="$version"}[$window]))',
                threshold: 100,
              },
            ],
            policy: "hold",
          },
        },
      },
    },
  });
  const accepted = await suite.cluster.database.deployment.update({
    where: { id: c.deployment.id },
    data: {
      pipelineRevisionId: "central/monitored-worker-fixture",
      monitorState: "watching",
      monitorSettledAt: null,
      startedAt: claimedAt,
      finishedAt: acceptedAt,
    },
  });
  return { ...pool, workerC, accepted };
}

function observation(activeAt: string[] = []) {
  return {
    observedAt: new Date().toISOString(),
    window: "120s",
    alarms: activeAt.map((at) => ({
      alertname: "TemporalWorkerErrors",
      severity: "critical" as const,
      labels: { environment: "temporal/prod" },
      activeAt: at,
    })),
    evidence: { workflows: 3 },
  };
}

test("a host retirement keeps a still-watching watch's clock (W1, W2)", async () => {
  const { workerA, workerC, accepted } = await watchingPool();
  const retired = await retire(workerA, workerC.buildId);
  expect(retired.monitorState).toBe("watching");
  expect(retired.startedAt?.getTime()).toBeGreaterThan(acceptedAt.getTime());
  // The evidence window spans the watch since the original acceptance.
  expect(await suite.delivery.watchingMonitors()).toMatchObject([
    { deploymentId: retired.id, acceptedAt: acceptedAt.toISOString() },
  ]);
  expect(
    await suite.delivery.monitorStatus(accepted.environmentId),
  ).toMatchObject({
    deploymentId: retired.id,
    claimedAt: claimedAt.toISOString(),
    state: "watching",
    observations: 0,
  });
  // An alarm active before the original claim stays pre-existing.
  const { observation: preExisting } = await suite.delivery.observeMonitor(
    retired.id,
    observation([beforeClaim]),
    testExecutor,
  );
  expect(preExisting.outcome).toBe("watching");
  // One that fired after the original claim counts, though it predates the
  // retirement's own claim.
  const { observation: counted } = await suite.delivery.observeMonitor(
    retired.id,
    observation([sinceClaim]),
    testExecutor,
  );
  expect(counted.outcome).toBe("alarmed");
});

test("a chain of host retirements keeps the original watch (W1)", async () => {
  const { workerA, workerB, workerC, accepted } = await watchingPool();
  const first = await retire(workerA, workerC.buildId);
  const { observation: watching } = await suite.delivery.observeMonitor(
    first.id,
    observation(),
    testExecutor,
  );
  expect(watching.outcome).toBe("watching");
  const second = await retire(workerB, workerC.buildId);
  expect(second).toMatchObject({
    previousAcceptedDeploymentId: first.id,
    monitorState: "watching",
  });
  expect(await suite.delivery.watchingMonitors()).toMatchObject([
    { deploymentId: second.id, acceptedAt: acceptedAt.toISOString() },
  ]);
  // Observations stay the evidence of the retirement that took them (V3).
  expect(
    await suite.delivery.monitorStatus(accepted.environmentId),
  ).toMatchObject({
    deploymentId: second.id,
    claimedAt: claimedAt.toISOString(),
    state: "watching",
    observations: 0,
  });
  const { observation: alarmed } = await suite.delivery.observeMonitor(
    second.id,
    observation([sinceClaim]),
    testExecutor,
  );
  expect(alarmed.outcome).toBe("alarmed");
});
