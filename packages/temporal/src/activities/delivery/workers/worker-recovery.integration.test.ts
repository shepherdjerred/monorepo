import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import {
  createTestDatabase,
  Delivery,
  workerFixture,
  testExecutor,
  testOperator,
} from "@shepherdjerred/delivery/testing";
import type { WorkerRecoveryContext } from "@shepherdjerred/delivery/contract";
import type { V1Job } from "@kubernetes/client-node";
import {
  proveSettledWorkerRecovery,
  type WorkerRecoveryEffects,
} from "#lib/delivery/workers/worker-recovery.ts";
import { proveTerminalWorkerJobs } from "#lib/delivery/workers/worker-recovery-jobs.ts";
import { workerSourceFingerprint } from "#lib/delivery/workers/worker-source.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import { retainedWorkerPod } from "./worker-fixtures.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let store: Delivery;
let context: WorkerRecoveryContext;
let job: V1Job;
let prior: unknown;
beforeAll(async () => {
  cluster = await createTestDatabase();
  store = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "Environment", "Pipeline", "Build", "VersionSet", "Request", "Audit" CASCADE',
  );
  const fixture = await workerFixture(store);
  const old = await fixture.acceptedRelease(1);
  await fixture.adopt(old);
  await fixture.freeze(old);
  const detail = await fixture.requestedFrozenRelease(2);
  await store.claim(detail.deployment.id, testExecutor);
  const definition = detail.pipeline.definition;
  if (definition.kind !== "argocd" || definition.workerRollout === undefined)
    throw new Error("Missing worker definition");
  job = deliveryJobManifest({
    deploymentId: detail.deployment.id,
    stageKey: "worker-image-provenance",
    recipe: "worker-images",
    runnerImage: definition.workerRollout.runnerImage,
    sourceRevision: "f".repeat(40),
    input: { deployment: detail.deployment },
  });
  job.metadata!.uid = "native-job-1";
  job.status = { active: 0, conditions: [{ type: "Failed", status: "True" }] };
  prior = {
    metadata: {
      uid: "native-application-1",
      resourceVersion: "10",
      annotations: {
        "delivery.shepherdjerred.com/environment": "temporal/prod",
      },
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "temporal",
        targetRevision: "1.0.1",
      },
      destination: { namespace: "temporal" },
    },
    status: {
      sync: { status: "Synced" },
      health: { status: "Healthy" },
      operationState: { phase: "Succeeded" },
    },
  };
  await store.stage(
    detail.deployment.id,
    {
      key: "worker-prior-source",
      status: "succeeded",
      operationId: workerSourceFingerprint(prior),
      message: "Captured prior source",
      evidence: [],
    },
    testExecutor,
  );
  await store.stage(
    detail.deployment.id,
    {
      key: "worker-image-provenance",
      status: "running",
      operationId: job.metadata!.name!,
      message: JSON.stringify({
        namespace: job.metadata!.namespace,
        name: job.metadata!.name,
        uid: job.metadata!.uid,
        specFingerprint:
          job.metadata!.annotations!["delivery.shepherdjerred.com/fingerprint"],
        requestId: detail.deployment.id,
      }),
      evidence: [],
    },
    testExecutor,
  );
  await store.finish(
    detail.deployment.id,
    {
      status: "failed",
      message: "Image inspection failed before effects",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const current = await store.detail(detail.deployment.id);
  const intent = await store.requestWorkerRecovery(
    detail.deployment.id,
    {
      requestId: crypto.randomUUID(),
      expectedEnvironmentGeneration: current.environment.generation,
      reason:
        "Independently inspect a failed readonly image Job before releasing retained ownership",
    },
    testOperator,
  );
  context = await store.workerRecovery(intent.id, testExecutor);
});

function boundary(): WorkerRecoveryEffects {
  const pool = context.deployment.deployment.workerSnapshot;
  const old = pool?.versions.find(
    (worker) =>
      worker.introducedByDeploymentId !== context.deployment.deployment.id,
  );
  if (old === undefined || pool === null)
    throw new Error("Missing original host");
  return {
    workflowClosed: async () => "delivery/source/closed-run",
    readArgo: async () => prior,
    terminalJobs: async (requested) =>
      await proveTerminalWorkerJobs(requested, {
        job: async () => job,
        pods: async () => [
          {
            metadata: {
              ownerReferences: [
                {
                  apiVersion: "batch/v1",
                  kind: "Job",
                  name: job.metadata!.name!,
                  uid: "native-job-1",
                },
              ],
            },
            status: { phase: "Failed" },
          },
        ],
      }),
    resources: async (_app, kind) =>
      kind === "Deployment"
        ? [
            {
              metadata: { name: "original" },
              spec: {
                replicas: 1,
                template: {
                  metadata: {
                    labels: { "worker-family": "central-workflows" },
                  },
                  spec: { containers: [{ image: old.image }] },
                },
              },
            },
          ]
        : [
            {
              metadata: { labels: { "worker-family": "central-workflows" } },
              spec: { containers: [{ name: "host", image: old.image }] },
              status: {
                phase: "Running",
                containerStatuses: [
                  {
                    name: "host",
                    ready: true,
                    imageID: old.runtimeDigests[0],
                    state: { running: {} },
                  },
                ],
              },
            },
          ],
    pollers: async (observed) => {
      expect(observed.versions.map((worker) => worker.id)).toEqual([old.id]);
    },
    routes: async () =>
      old.host.routes.map((route) => ({
        ...route,
        currentBuildId: old.buildId,
        rampingBuildId: null,
        routingConflictToken: `${route.namespace}-token`,
      })),
    noCandidateReferences: async () => {
      expect(pool?.candidateBuildId).not.toBe(old.buildId);
    },
  };
}

test("pre-PATCH readonly failure releases exact held ownership with original hosts and unchanged semantic source, without accepting failed release", async () => {
  const external = boundary();
  const proof = await proveSettledWorkerRecovery(context, external);
  await store.completeWorkerRecovery(context.intent.id, proof, testExecutor);
  const result = await store.detail(context.deployment.deployment.id);
  expect(result.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: false,
  });
  expect(result.environment.activeDeploymentId).toBeNull();
  expect(result.environment.acceptedVersionSetRevisionId).toBe(
    context.deployment.environment.acceptedVersionSetRevisionId,
  );
  expect(proof.routes.map((route) => route.namespace)).toEqual([
    "prod",
    "beta",
  ]);
  expect(proof.evidence).toContainEqual(
    expect.objectContaining({
      operationId: "native-job-1",
      kind: "reconciliation",
    }),
  );
});
test("unknown Job incarnation, live executor and candidate references retain the lock", async () => {
  const external = boundary();
  job.metadata!.uid = "replaced-job";
  await expect(proveSettledWorkerRecovery(context, external)).rejects.toThrow(
    "incarnation",
  );
  job.metadata!.uid = "native-job-1";
  job.status!.active = 1;
  await expect(proveSettledWorkerRecovery(context, external)).rejects.toThrow(
    "terminal",
  );
  job.status!.active = 0;
  await expect(
    proveSettledWorkerRecovery(context, {
      ...external,
      noCandidateReferences: async () => {
        throw new Error("candidate pinned");
      },
    }),
  ).rejects.toThrow("candidate pinned");
  expect(await cluster.database.applicationLock.count()).toBe(1);
});
test("source ownership changes, beta routing changes and stale completion cannot unlock", async () => {
  const external = boundary();
  const proof = await proveSettledWorkerRecovery(context, external);
  await expect(
    store.completeWorkerRecovery(
      context.intent.id,
      { ...proof, observedAt: new Date(Date.now() - 61_000).toISOString() },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  let reads = 0;
  await expect(
    proveSettledWorkerRecovery(context, {
      ...external,
      routes: async (pool) => {
        const routes = await external.routes(pool);
        return routes.map((route) => ({
          ...route,
          routingConflictToken: String(++reads),
        }));
      },
    }),
  ).rejects.toThrow("changed");
  await expect(
    proveSettledWorkerRecovery(context, {
      ...external,
      readArgo: async () => ({
        metadata: { uid: "replaced" },
        spec: { source: {} },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          operationState: { phase: "Succeeded" },
        },
      }),
    }),
  ).rejects.toThrow("prior source");
  expect(await cluster.database.applicationLock.count()).toBe(1);
});

test("post-PATCH bootstrap recovery requires its exact finished native operation and every frozen host", async () => {
  const detail = context.deployment;
  const pool = detail.deployment.workerSnapshot;
  if (pool === null) throw new Error("Missing frozen snapshot");
  const { selection } = deliverySelection(detail);
  const requestId = deliveryOperationId(
    `${detail.deployment.id}:worker-bootstrap`,
  );
  await cluster.database.stage.create({
    data: {
      id: crypto.randomUUID(),
      deploymentId: detail.deployment.id,
      key: "worker-host-bootstrap",
      status: "running",
      operationId: requestId,
      message: "Owned bootstrap selected and sync response lost",
    },
  });
  context = await store.workerRecovery(context.intent.id, testExecutor);
  const source = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: selection.revision,
    helm: {
      parameters: Object.entries({
        ...selection.parameters,
        "delivery.legacyWorkers": "keep",
      }).map(([name, value]) => ({ name, value, forceString: true })),
    },
  };
  const operationId = crypto.randomUUID();
  const application = {
    metadata: { uid: "native-application-1" },
    spec: { source },
    status: {
      sync: { status: "Synced", revision: selection.revision },
      health: { status: "Healthy" },
      history: [{ id: 1, revision: selection.revision, source }],
      operationState: {
        phase: "Succeeded",
        finishedAt: new Date().toISOString(),
        syncResult: { revision: selection.revision },
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: operationId },
          ],
        },
      },
    },
  };
  const external = boundary();
  const effects: WorkerRecoveryEffects = {
    ...external,
    readArgo: async () => application,
    pollers: async (observed) => {
      expect(observed.versions).toHaveLength(2);
    },
    resources: async (_app, kind) =>
      kind === "Deployment"
        ? []
        : pool.versions.map((worker) => retainedWorkerPod(worker)),
  };
  const proof = await proveSettledWorkerRecovery(context, effects);
  expect(proof.evidence).toContainEqual(
    expect.objectContaining({ kind: "reconciliation", operationId }),
  );
  await expect(
    proveSettledWorkerRecovery(context, {
      ...effects,
      resources: async () => [],
    }),
  ).rejects.toThrow("ready Pod");
  await expect(
    proveSettledWorkerRecovery(context, {
      ...effects,
      readArgo: async () => ({ ...application, operation: { sync: {} } }),
    }),
  ).rejects.toThrow();
  await store.completeWorkerRecovery(context.intent.id, proof, testExecutor);
  const result = await store.detail(detail.deployment.id);
  expect(result.deployment.status).toBe("failed");
});
