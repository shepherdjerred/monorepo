import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { freshWorkerProof, workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { createApp } from "./app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import {
  WorkerPoolTargetSchema,
  WorkerRecoveryObservationSchema,
  workerHostSpecification,
  type CompleteWorkerRecovery,
  type Principal,
} from "#shared/contract.ts";
import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import {
  createWorkerRecoveryReader,
  type WorkerRecoveryReaders,
} from "#infrastructure/worker-pool/recovery-observation.ts";
import { createApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { requestStackDeployment } from "#testing/tofu-stack-fixture.ts";
import { publishCiRunner } from "#testing/model-fixture.ts";

const context = useDeliveryFixture();
const admin: Principal = {
  id: "recovery-admin",
  kind: "machine",
  scopes: ["read", "admin"],
};
async function responseStatus(pending: Promise<Response> | Response) {
  const response = await pending;
  return response.status;
}

async function failedWorker(
  recipe?: (workers: Awaited<ReturnType<typeof workerFixture>>) => {
    id: string;
    definition: object;
  },
) {
  const workers = await workerFixture(context.delivery);
  const baseline = await workers.acceptedPool();
  const deployment = await context.delivery.retireWorker(
    baseline.workerA.id,
    {
      requestId: "retire/ambiguous",
      expectedEnvironmentGeneration: baseline.env.generation,
      expectedWorkerGeneration: baseline.workerA.generation,
    },
    testOperator,
  );
  // A retirement freezes the accepted release's reviewed worker recipe.
  await workers.frozenRecipe(deployment.id, recipe?.(workers));
  await context.delivery.claim(
    deployment.id,
    testExecutor,
    freshWorkerProof(baseline.workerA, baseline.workerB.buildId),
  );
  await context.delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "recorded-operation",
      message: "Response lost after owned effect",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Original ambiguous failure must remain immutable",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const pool = await context.delivery.workers(
    workers.environmentId,
    testOperator,
  );
  const before = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  return { workers, baseline, deployment, pool, before };
}
function api(readers?: WorkerRecoveryReaders) {
  const app = createApp({
    delivery: context.delivery,
    ...(readers === undefined ? {} : { workerRecoveryReaders: readers }),
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    peerAddress: () => null,
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => false,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: [
        { token: "recovery-fixture-admin", principal: admin },
        { token: "recovery-fixture-executor", principal: testExecutor },
      ],
    },
  });
  const client = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: "Bearer recovery-fixture-admin" },
    fetch: async (url, init) => app.request(url, init),
  });
  function post(path: string, body: unknown, executor = true) {
    return app.request(`/api/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer recovery-fixture-${executor ? "executor" : "admin"}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  return { app, client, post };
}

test("independent recovery works through authenticated HTTP while workflows/writes are unavailable and preserves failed result", async () => {
  const { baseline, deployment, pool, before } = await failedWorker();
  const { client, post } = api();
  const input = {
    requestId: "independent-recovery",
    expectedEnvironmentGeneration: pool.generation,
    reason:
      "Inspect exact quarantined operation independently of the Workflow worker",
  };
  const intent = await client.requestWorkerRecovery(deployment.id, input);
  expect(await client.requestWorkerRecovery(deployment.id, input)).toEqual(
    intent,
  );
  const current = await client.workerRecovery(intent.id);
  expect(current.pool).toEqual(pool);
  expect(current.deployment.deployment.status).toBe("failed");
  const observation: CompleteWorkerRecovery = {
    expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
    snapshotFingerprint: intent.snapshotFingerprint,
    poolFingerprint: intent.poolFingerprint,
    observedAt: new Date().toISOString(),
    routes: baseline.workerB.host.routes.map((route) => ({
      ...route,
      currentBuildId: baseline.workerB.buildId,
      rampingBuildId: null,
      routingConflictToken: "independently-observed-token",
    })),
    evidence: [
      {
        kind: "reconciliation",
        operationId: "recorded-operation",
        summary:
          "Independent observer fixture: exact operation finished and all bounded Jobs terminal",
      },
      {
        kind: "runtime",
        summary:
          "Independent observer fixture: exact retained hosts and stable routing read back",
      },
    ],
  };
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, observation, false),
    ),
  ).toBe(403);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/submitted`, {
        workflowId: "unrelated-workflow",
      }),
    ),
  ).toBe(409);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        observedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    ),
  ).toBe(409);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        routes: observation.routes.slice(0, 1),
      }),
    ),
  ).toBe(409);
  const settled = await post(
    `/worker-recovery/${intent.id}/complete`,
    observation,
  );
  expect(settled.status).toBe(200);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, observation),
    ),
  ).toBe(200);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        observedAt: new Date(Date.now() + 1).toISOString(),
      }),
    ),
  ).toBe(409);
  const after = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  expect(after).toMatchObject({
    status: before.status,
    message: before.message,
    resultFingerprint: before.resultFingerprint,
    workerSnapshot: before.workerSnapshot,
    recoveryRequired: false,
  });
  expect(
    await context.delivery.workers(pool.environmentId, testOperator),
  ).toEqual(pool);
  expect(await context.cluster.database.targetLock.count()).toBe(0);
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: pool.environmentId },
  });
  expect(env.acceptedVersionSetRevisionId).toBe(baseline.b.version.id);
  expect(env.activeDeploymentId).toBeNull();
});

test("pool CAS and immutable recovery failures keep original quarantine intact", async () => {
  const { baseline, deployment, pool } = await failedWorker();
  const intent = await context.delivery.requestWorkerRecovery(
    deployment.id,
    {
      requestId: "recovery/cas",
      expectedEnvironmentGeneration: pool.generation,
      reason:
        "Independently inspect exact original immutable worker identities",
    },
    admin,
  );
  await expect(
    context.delivery.requestWorkerRecovery(
      deployment.id,
      {
        requestId: "recovery/concurrent",
        expectedEnvironmentGeneration: pool.generation,
        reason: "A second inspection must not race an existing intent",
      },
      admin,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await context.cluster.database.workerVersion.update({
    where: { id: baseline.workerA.id },
    data: { generation: { increment: 1 } },
  });
  await expect(
    context.delivery.completeWorkerRecovery(
      intent.id,
      {
        expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
        snapshotFingerprint: intent.snapshotFingerprint,
        poolFingerprint: intent.poolFingerprint,
        observedAt: new Date().toISOString(),
        routes: baseline.workerB.host.routes.map((route) => ({
          ...route,
          currentBuildId: baseline.workerB.buildId,
          rampingBuildId: null,
          routingConflictToken: "token",
        })),
        evidence: [
          {
            kind: "reconciliation",
            operationId: "recorded-operation",
            summary: "Read-only boundary fixture",
          },
          { kind: "runtime", summary: "Read-only host fixture" },
        ],
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await context.delivery.failWorkerRecovery(
    intent.id,
    "Independent host/route proof unavailable; quarantine retained",
    testExecutor,
  );
  await context.delivery.failWorkerRecovery(
    intent.id,
    "Independent host/route proof unavailable; quarantine retained",
    testExecutor,
  );
  await expect(
    context.delivery.failWorkerRecovery(
      intent.id,
      "Different outcome",
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  // The worker recipe's claim holds its Application and its pool.
  const held = await context.cluster.database.targetLock.findMany({
    orderBy: { instance: "asc" },
  });
  expect(held.map((lock) => lock.instance)).toEqual([
    "application:temporal",
    "worker-pool:central",
  ]);
  const quarantined =
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    });
  expect(quarantined.recoveryRequired).toBe(true);
});

test("the API observes a pending worker recovery with its own readers, never an executor credential", async () => {
  const { deployment, pool } = await failedWorker();
  const reads: string[] = [];
  const readers: WorkerRecoveryReaders = {
    readApplication: async (name) => {
      reads.push(`application:${name}`);
      return { metadata: { name } };
    },
    readKubernetes: async (path) => {
      reads.push(path);
      const collection = path.split("?")[0]?.split("/").at(-1);
      return { items: [{ metadata: { name: collection } }] };
    },
  };
  const { app, client, post } = api(readers);
  const intent = await client.requestWorkerRecovery(deployment.id, {
    requestId: "observed-recovery",
    expectedEnvironmentGeneration: pool.generation,
    reason: "Observe the retained worker hosts with the API's own identity",
  });
  const observe = (via = app, credential = "executor") =>
    via.request(`/api/v1/worker-recovery/${intent.id}/observation`, {
      headers: { Authorization: `Bearer recovery-fixture-${credential}` },
    });
  expect(await responseStatus(observe(app, "admin"))).toBe(403);
  const response = await observe();
  expect(response.status).toBe(200);
  expect(WorkerRecoveryObservationSchema.parse(await response.json())).toEqual({
    application: { metadata: { name: "temporal" } },
    deployments: [{ metadata: { name: "deployments" } }],
    pods: [{ metadata: { name: "pods" } }],
  });
  expect(reads).toEqual([
    "application:temporal",
    "/apis/apps/v1/namespaces/temporal/deployments",
    "/api/v1/namespaces/temporal/pods?labelSelector=worker-family",
  ]);
  // No configured reader or projection pauses; nothing falls back.
  expect(await responseStatus(observe(api().app))).toBe(503);
  const unprojected = api({
    readApplication: createApplicationReader(() =>
      Promise.reject(new Error("token file missing")),
    ),
    readKubernetes: createWorkerRecoveryReader(() =>
      Promise.reject(new Error("token file missing")),
    ),
  });
  expect(await responseStatus(observe(unprojected.app))).toBe(503);
  const absent = api({ ...readers, readApplication: async () => null });
  expect(await responseStatus(observe(absent.app))).toBe(409);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/fail`, {
        message: "Operator stopped this inspection",
      }),
    ),
  ).toBe(200);
  expect(await responseStatus(observe())).toBe(409);
});

test("every worker host namespace has the declared recovery reader grant", () => {
  const granted: readonly string[] =
    DELIVERY_KUBERNETES_READERS.workerRecovery.namespaces;
  expect(
    WorkerPoolTargetSchema.options.map(
      (target) => workerHostSpecification(target).kubernetesNamespace,
    ),
  ).toEqual(granted);
});

/**
 * The fixture's worker recipe as a compound recipe whose first Application,
 * `temporal-ui`, is the one catalog reconcile binds the environment to; the
 * worker-rollout step runs in the Application named by `worker`.
 */
function compoundWorkerRecipe(
  workers: Awaited<ReturnType<typeof failedWorker>>["workers"],
  worker: "temporal" | "temporal-ui",
) {
  const temporal = recipeFromPipeline(
    PipelineDefinitionSchema.parse(workers.workerPipeline.definition),
  );
  if (temporal.kind !== "kubernetes-application")
    throw new Error("The worker recipe converts to a Kubernetes application");
  const application = (name: string, rollout: boolean) => ({
    ...temporal,
    application: { ...temporal.application, name },
    steps: temporal.steps
      .filter((step) => rollout || step.kind !== "worker-rollout")
      .map((step) =>
        step.kind === "worker-rollout"
          ? step
          : { ...step, instance: `application:${name}` },
      ),
  });
  return {
    id: `central/compound-${worker}`,
    definition: RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: "application:temporal-ui",
          definition: application("temporal-ui", worker === "temporal-ui"),
        },
        {
          instance: "application:temporal",
          definition: application("temporal", worker === "temporal"),
        },
      ],
    }),
  };
}

/** A pending recovery of a deployment that froze `recipe`, its environment bound to `temporal-ui`. */
async function compoundRecovery(worker: "temporal" | "temporal-ui") {
  const { workers, deployment, pool } = await failedWorker();
  await workers.frozenRecipe(
    deployment.id,
    compoundWorkerRecipe(workers, worker),
  );
  await context.cluster.database.environment.update({
    where: { id: pool.environmentId },
    data: { application: "temporal-ui" },
  });
  const reads: string[] = [];
  const { app, client } = api({
    readApplication: async (name) => {
      reads.push(`application:${name}`);
      return { metadata: { name } };
    },
    readKubernetes: async () => ({ items: [] }),
  });
  const intent = await client.requestWorkerRecovery(deployment.id, {
    requestId: `compound-recovery-${worker}`,
    expectedEnvironmentGeneration: pool.generation,
    reason: "Observe the compound recipe's worker Application",
  });
  const response = await app.request(
    `/api/v1/worker-recovery/${intent.id}/observation`,
    { headers: { Authorization: "Bearer recovery-fixture-executor" } },
  );
  return { response, reads };
}

test("a compound recipe's worker Application is observed although the environment binds its first Application (D5)", async () => {
  const { response, reads } = await compoundRecovery("temporal");
  expect(response.status).toBe(200);
  expect(reads).toEqual(["application:temporal"]);
});

test("a frozen recipe that rolls the pool from another Application is refused before any read", async () => {
  const { response, reads } = await compoundRecovery("temporal-ui");
  expect(response.status).toBe(400);
  expect(reads).toEqual([]);
});

/** The fixture's worker recipe declaring the shared platform lock, so admission takes it. */
function platformLockedWorkerRecipe(
  workers: Awaited<ReturnType<typeof workerFixture>>,
) {
  return {
    id: "central/platform-locked-worker",
    definition: RecipeDefinitionSchema.parse({
      ...recipeFromPipeline(
        PipelineDefinitionSchema.parse(workers.workerPipeline.definition),
      ),
      sharedLock: "platform",
    }),
  };
}

test("worker recovery settlement releases the platform lock its holder kept, so a queued platform deployment claims", async () => {
  // A model recipe binds the CI runner by reference (C2).
  await publishCiRunner(context.delivery);
  const { baseline, deployment, pool } = await failedWorker(
    platformLockedWorkerRecipe,
  );
  const db = context.cluster.database;
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: deployment.id });
  const { deployment: stack } = await requestStackDeployment(context);
  await expect(
    context.delivery.claim(stack.id, testExecutor),
  ).rejects.toMatchObject({ code: "BUSY" });
  const intent = await context.delivery.requestWorkerRecovery(
    deployment.id,
    {
      requestId: "recovery/platform-lock",
      expectedEnvironmentGeneration: pool.generation,
      reason: "Independently inspect the platform-locked worker operation",
    },
    admin,
  );
  await context.delivery.completeWorkerRecovery(
    intent.id,
    {
      expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
      snapshotFingerprint: intent.snapshotFingerprint,
      poolFingerprint: intent.poolFingerprint,
      observedAt: new Date().toISOString(),
      routes: baseline.workerB.host.routes.map((route) => ({
        ...route,
        currentBuildId: baseline.workerB.buildId,
        rampingBuildId: null,
        routingConflictToken: "independently-observed-token",
      })),
      evidence: [
        {
          kind: "reconciliation",
          operationId: "recorded-operation",
          summary: "Independent observer fixture: exact operation finished",
        },
        {
          kind: "runtime",
          summary:
            "Independent observer fixture: exact retained hosts and stable routing read back",
        },
      ],
    },
    testExecutor,
  );
  expect(
    await db.deployment.findUniqueOrThrow({ where: { id: deployment.id } }),
  ).toMatchObject({ status: "failed", recoveryRequired: false });
  expect(await db.platformLock.count()).toBe(0);
  expect(await db.targetLock.count()).toBe(0);
  await context.delivery.claim(stack.id, testExecutor);
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });
});
