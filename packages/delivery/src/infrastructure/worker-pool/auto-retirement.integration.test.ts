import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { freshWorkerProof, workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { AUTO_RETIRE_ACTOR } from "./auto-retirement.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof workerFixture>>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "Environment", "Pipeline", "Build", "VersionSet", "Request", "Audit" CASCADE',
  );
  fixture = await workerFixture(delivery);
});

test("an idle environment offers its retained, unreferenced hosts but never the accepted candidate", async () => {
  const { workerA, workerB, env } = await fixture.acceptedPool();
  const { environments } = await delivery.retirementCandidates(testExecutor);
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
  const { workerA, env } = await fixture.acceptedPool();
  const input = {
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const requested = await delivery.autoRetireWorker(
    workerA.id,
    input,
    testExecutor,
  );
  expect(requested).toMatchObject({
    kind: "retire-host",
    requestedBy: AUTO_RETIRE_ACTOR.id,
  });
  expect(
    await delivery.autoRetireWorker(workerA.id, input, testExecutor),
  ).toEqual(requested);
  // A pending retirement leaves the environment busy: nothing more is offered.
  const { environments } = await delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
});

test("only the executor proposes retirements", async () => {
  const { workerA, env } = await fixture.acceptedPool();
  await expect(
    delivery.retirementCandidates(testOperator),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    delivery.autoRetireWorker(
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
  const { workerA, workerB, env } = await fixture.acceptedPool();
  const input = {
    expectedEnvironmentGeneration: env.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const requested = await delivery.autoRetireWorker(
    workerA.id,
    input,
    testExecutor,
  );
  await delivery.claim(
    requested.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  await delivery.finish(
    requested.id,
    {
      status: "failed",
      message: "Retirement fence refused",
      recoveryRequired: false,
      evidence: [{ kind: "preflight", summary: "Pinned execution appeared" }],
    },
    testExecutor,
  );
  const { environments } = await delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
  await expect(
    delivery.autoRetireWorker(
      workerA.id,
      { ...input, expectedWorkerGeneration: workerA.generation },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("an environment whose releases require approval keeps retirement an operator decision", async () => {
  const { env } = await fixture.acceptedPool();
  await cluster.database.environment.update({
    where: { id: env.id },
    data: { approvalPolicy: "required" },
  });
  const { environments } = await delivery.retirementCandidates(testExecutor);
  expect(environments).toEqual([]);
});
