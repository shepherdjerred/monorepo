import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { z } from "zod";
import {
  createApp,
  createTestDatabase,
  Delivery,
  workerFixture,
  testExecutor,
  testOperator,
} from "@shepherdjerred/delivery/testing";
import type {
  DeploymentDetail,
  WorkerPoolSnapshot,
} from "@shepherdjerred/delivery/contract";
import {
  deliveryArgoParameters,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import { requirePoolRoutingCoverage } from "#lib/delivery/workers/worker-retirement.ts";
import {
  bootstrapDeliveryWorkerHosts,
  type WorkerBootstrapEffects,
} from "./worker-bootstrap.ts";
import { verifyWorkerPoolPods } from "#lib/delivery/workers/worker-hosts.ts";
import { verifyArgoRelease } from "#activities/delivery/argocd.ts";
import {
  observeWorkerBaseline,
  type WorkerBaselineEffects,
} from "./worker-baseline.ts";
import { finishDelivery } from "#activities/delivery/execute.ts";
import { workerSourceFingerprint } from "#lib/delivery/workers/worker-source.ts";
import { SettledArgoStatusSchema } from "#lib/delivery/argocd-proof.ts";
import { retainedWorkerPod } from "./worker-fixtures.ts";

/** `finishDelivery` reports as the Activity of its executor Workflow (D7). */
/** The bootstrap writes its stages as the executor's Activity (D7). */
async function bootstrapAsExecutor(
  ...args: Parameters<typeof bootstrapDeliveryWorkerHosts>
) {
  return await new MockActivityEnvironment().run(
    bootstrapDeliveryWorkerHosts,
    ...args,
  );
}
async function finishAsExecutor(...args: Parameters<typeof finishDelivery>) {
  return await new MockActivityEnvironment().run(finishDelivery, ...args);
}

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let store: Delivery;
let server: ReturnType<typeof Bun.serve>;
let detail: DeploymentDetail;
let pool: WorkerPoolSnapshot;
function appReleasePointers(environment: {
  acceptedVersionSetRevisionId: string | null;
  observedVersionSetRevisionId: string | null;
  desiredVersionSetRevisionId: string | null;
}) {
  return [
    environment.acceptedVersionSetRevisionId,
    environment.observedVersionSetRevisionId,
    environment.desiredVersionSetRevisionId,
  ];
}
async function captureBaselineSource(
  id: string,
  effects: WorkerBaselineEffects,
) {
  await store.stage(
    id,
    {
      key: "worker-prior-source",
      status: "succeeded",
      operationId: workerSourceFingerprint(
        await effects.application("temporal"),
      ),
      message: "Captured original source identity before readonly observation",
      evidence: [],
    },
    testExecutor,
  );
  return await store.detail(id);
}

beforeAll(async () => {
  cluster = await createTestDatabase();
  store = new Delivery(cluster.database);
  const app = createApp({
    delivery: store,
    peerAddress: () => "127.0.0.1",
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://localhost",
      machineCredentials: [
        { token: "local-worker-executor", principal: testExecutor },
      ],
      writesEnabled: async () => true,
      enabledEnvironments: async () => ["temporal/prod"],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
    },
  });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  vi.stubEnv("DELIVERY_API_URL", server.url.origin);
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "local-worker-executor");
}, 60_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await server.stop(true);
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
  detail = await fixture.requestedFrozenRelease(2);
  await store.claim(detail.deployment.id, testExecutor);
  const snapshot = detail.deployment.workerSnapshot;
  if (snapshot === null) throw new Error("Missing real frozen worker pool");
  pool = snapshot;
  await store.stage(
    detail.deployment.id,
    {
      key: "worker-image-provenance",
      status: "succeeded",
      operationId: "local-image-inspection",
      message: "Fixture boundary verified every original image Git SHA",
      evidence: [],
    },
    testExecutor,
  );
  detail = await store.detail(detail.deployment.id);
});

function observation(selection: DeliverySelection, operationId: string) {
  const source = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: selection.revision,
    helm: {
      parameters: deliveryArgoParameters(selection.parameters),
    },
  };
  return {
    spec: { source },
    status: {
      sync: { status: "Synced", revision: selection.revision },
      health: { status: "Healthy" },
      history: [{ id: 1, revision: selection.revision, source }],
      operationState: {
        phase: "Succeeded",
        finishedAt: new Date().toISOString(),
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: operationId },
            {
              name: "ci.sjer.red/operation-id",
              value: "00000000-0000-4000-8000-000000000001",
            },
          ],
        },
        syncResult: { revision: selection.revision },
      },
    },
  };
}
function boundary(
  options: { uncovered?: boolean; missingHost?: boolean } = {},
) {
  const selections: DeliverySelection[] = [];
  const receipts: string[] = [];
  const first = pool.versions[0];
  if (first === undefined) throw new Error("Missing original worker");
  const effects: WorkerBootstrapEffects = {
    async controlPlane() {
      /* Separate template-fingerprint integration covers this external boundary. */
    },
    async inspect(_application, kind) {
      if (kind === "Pod") return [];
      return [
        {
          metadata: { name: "temporal-temporal-workflows-stable" },
          spec: {
            replicas: 1,
            template: {
              metadata: { labels: { "worker-family": "central-workflows" } },
              spec: {
                containers: [
                  {
                    image:
                      options.uncovered === true
                        ? `docker.io/shepherdjerred/temporal-worker@sha256:${"f".repeat(64)}`
                        : first.image,
                  },
                ],
              },
            },
          },
        },
      ];
    },
    async routing(snapshot) {
      await requirePoolRoutingCoverage(snapshot, async () => ({
        currentBuildId: first.buildId,
        rampingBuildId: null,
        token: "local-route",
      }));
    },
    async select(selection) {
      selections.push(selection);
    },
    async sync(_selection, operationId) {
      receipts.push(operationId);
    },
    async verify(selection, operationId) {
      verifyArgoRelease(
        observation(selection, operationId),
        selection,
        operationId,
      );
    },
    async hosts() {
      const versions =
        options.missingHost === true
          ? pool.versions.slice(0, 1)
          : pool.versions;
      verifyWorkerPoolPods(
        versions.map((worker) => retainedWorkerPod(worker)),
        pool,
      );
    },
  };
  return { effects, selections, receipts };
}

test("genuine PostgreSQL pool bootstraps only exact retained images without a Git legacy selector", async () => {
  const external = boundary();
  await bootstrapAsExecutor(detail, external.effects);
  expect(external.selections).toHaveLength(1);
  expect(external.selections[0]?.parameters).not.toHaveProperty(
    "delivery.legacyWorkers",
  );
  const final = deliverySelection(await store.detail(detail.deployment.id));
  expect(final.selection.parameters).not.toHaveProperty(
    "delivery.legacyWorkers",
  );
  expect(final.selection.parameters["delivery.workerPool"]).toBe(
    external.selections[0]?.parameters["delivery.workerPool"],
  );
  expect(external.receipts[0]).not.toBe(final.operationId);
  const stored = await store.detail(detail.deployment.id);
  expect(stored.stages).toContainEqual(
    expect.objectContaining({
      key: "worker-host-bootstrap",
      status: "succeeded",
      operationId: external.receipts[0],
    }),
  );
  expect(stored.environment.activeDeploymentId).toBe(detail.deployment.id);
  // The Application and the worker pool are both held instances (T1).
  expect(
    await cluster.database.targetLock.count({
      where: { deploymentId: detail.deployment.id },
    }),
  ).toBe(2);
});
test("an uncovered legacy build blocks before any Argo mutation or external-intent stage", async () => {
  const external = boundary({ uncovered: true });
  await expect(bootstrapAsExecutor(detail, external.effects)).rejects.toThrow(
    "qualified retained-pool coverage",
  );
  expect(external.selections).toEqual([]);
  const stored = await store.detail(detail.deployment.id);
  expect(
    stored.stages.some((stage) => stage.key === "worker-host-bootstrap"),
  ).toBe(false);
});
test("missing replacement Pod proof leaves the bootstrap intent running and the PostgreSQL lock held", async () => {
  const external = boundary({ missingHost: true });
  await expect(bootstrapAsExecutor(detail, external.effects)).rejects.toThrow(
    "ready Pod",
  );
  expect(external.selections).toHaveLength(1);
  expect(external.selections[0]?.parameters["delivery.workerPool"]).toBe(
    deliverySelection(detail).selection.parameters["delivery.workerPool"],
  );
  const stored = await store.detail(detail.deployment.id);
  expect(stored.stages).toContainEqual(
    expect.objectContaining({
      key: "worker-host-bootstrap",
      status: "running",
    }),
  );
  // The Application and the worker pool are both held instances (T1).
  expect(
    await cluster.database.targetLock.count({
      where: { deploymentId: detail.deployment.id },
    }),
  ).toBe(2);
});

async function observeComparisonDrift(
  baseline: DeploymentDetail,
  effects: WorkerBaselineEffects,
  comparison: (status: string) => void,
) {
  comparison("OutOfSync");
  const evidence = await observeWorkerBaseline(baseline, effects);
  expect(
    evidence.some((entry) =>
      entry.summary.includes("Argo comparison OutOfSync"),
    ),
  ).toBe(true);
  const status = z
    .object({ status: z.unknown() })
    .parse(await effects.application("temporal")).status;
  expect(() => SettledArgoStatusSchema.parse(status)).toThrow();
  comparison("Unknown");
  await expect(observeWorkerBaseline(baseline, effects)).rejects.toThrow();
  comparison("OutOfSync");
  return evidence;
}

test("independent original-A hosts and captured older chart leave qualified app-C acceptance untouched", async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "Environment", "Pipeline", "Build", "VersionSet", "Request", "Audit" CASCADE',
  );
  const fixture = await workerFixture(store);
  const a = await fixture.requestedRelease(1);
  await store.cancel(a.deployment.id, testOperator);
  const c = await fixture.requestedRelease(3);
  await store.cancel(c.deployment.id, testOperator);
  await store.registerPipeline(
    fixture.workerPipeline.id,
    fixture.workerPipeline.definition,
    testOperator,
  );
  await store.registerEnvironment(
    {
      id: fixture.environmentId,
      serviceId: "temporal",
      name: "prod",
      application: "temporal",
      pipelineRevisionId: fixture.workerPipeline.id,
      configurationRevision: "baseline/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const before = await cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environmentId },
  });
  const adoption = await store.createDeployment(
    {
      requestId: "observe-A-on-C",
      environmentId: fixture.environmentId,
      versionSetRevisionId: c.version.id,
      expectedGeneration: before.generation,
      kind: "adopt-worker",
      workerBaseline: {
        artifactIds: [a.artifactId],
        candidateArtifactId: a.artifactId,
      },
    },
    testOperator,
  );
  detail = await store.claim(adoption.id, testExecutor);
  if (detail.deployment.workerSnapshot === null)
    throw new Error("Missing baseline snapshot");
  pool = detail.deployment.workerSnapshot;
  await store.stage(
    adoption.id,
    {
      key: "worker-image-provenance",
      status: "succeeded",
      operationId: "image-A",
      message: "Readonly original image config verified",
      evidence: [],
    },
    testExecutor,
  );
  detail = await store.detail(adoption.id);
  const original = pool.versions[0];
  if (original === undefined) throw new Error("Missing original worker");
  const reads: string[] = [];
  const observedAt = new Date().toISOString();
  let reportedRevision = "1.0.1";
  let comparisonStatus = "Synced";
  const effects: WorkerBaselineEffects = {
    async application() {
      reads.push("argo");
      return {
        metadata: { uid: "original-application", annotations: {} },
        spec: {
          source: {
            repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
            chart: "temporal",
            targetRevision: "1.0.1",
          },
        },
        status: {
          sync: { status: comparisonStatus, revision: reportedRevision },
          health: { status: "Healthy" },
          operationState: { phase: "Succeeded", finishedAt: observedAt },
        },
      };
    },
    async resources(_app, kind) {
      reads.push(kind);
      return kind === "Deployment"
        ? [
            {
              metadata: { name: "legacy-stable" },
              spec: {
                replicas: 1,
                template: {
                  metadata: {
                    labels: { "worker-family": "central-workflows" },
                  },
                  spec: { containers: [{ image: original.image }] },
                },
              },
            },
          ]
        : [
            {
              metadata: { labels: { "worker-family": "central-workflows" } },
              spec: { containers: [{ name: "host", image: original.image }] },
              status: {
                phase: "Running",
                containerStatuses: [
                  {
                    name: "host",
                    ready: true,
                    imageID: original.runtimeDigests[0],
                    state: { running: {} },
                  },
                ],
              },
            },
          ];
    },
    async pollers(selected) {
      reads.push(
        ...selected.versions.flatMap((worker) =>
          worker.host.routes.map((route) => `poller:${route.namespace}`),
        ),
      );
    },
    async routing() {
      return [
        {
          namespace: "prod",
          currentBuildId: original.buildId,
          rampingBuildId: null,
          token: "prod-token",
        },
        {
          namespace: "beta",
          currentBuildId: original.buildId,
          rampingBuildId: null,
          token: "beta-token",
        },
      ];
    },
  };
  detail = await captureBaselineSource(adoption.id, effects);
  reads.length = 0;
  await observeWorkerBaseline(detail, effects);
  expect(reads).toEqual([
    "argo",
    "Deployment",
    "Pod",
    "poller:prod",
    "poller:beta",
    "argo",
  ]);
  const evidence = await observeComparisonDrift(detail, effects, (status) => {
    comparisonStatus = status;
  });
  reportedRevision = "1.0.2";
  await expect(observeWorkerBaseline(detail, effects)).rejects.toThrow(
    "exact settled captured chart",
  );
  reportedRevision = "1.0.1";
  const app = await effects.application("temporal");
  await expect(
    observeWorkerBaseline(detail, {
      ...effects,
      application: async () => ({
        ...z.record(z.string(), z.unknown()).parse(app),
        operation: { sync: {} },
      }),
    }),
  ).rejects.toThrow();
  await expect(
    observeWorkerBaseline(detail, { ...effects, resources: async () => [] }),
  ).rejects.toThrow("no live host");
  await store.stage(
    adoption.id,
    {
      key: "worker-baseline",
      status: "succeeded",
      operationId: deliveryOperationId(`${adoption.id}:worker-baseline`),
      message: "Original runtime and all routes independently observed",
      evidence,
    },
    testExecutor,
  );
  await finishAsExecutor(adoption.id, { status: "succeeded", evidence });
  const after = await cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environmentId },
  });
  expect(appReleasePointers(after)).toEqual(appReleasePointers(before));
  const adopted = await store.workers(fixture.environmentId, testOperator);
  expect(adopted.versions).toMatchObject([
    { artifactId: a.artifactId, sourceRevision: "1".padEnd(40, "0") },
  ]);
});
