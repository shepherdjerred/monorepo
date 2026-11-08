import { expect, test } from "vitest";
import { freshWorkerProof } from "#testing/worker-fixture.ts";
import { workerPoolSuite } from "#testing/worker-pool-suite.ts";
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
