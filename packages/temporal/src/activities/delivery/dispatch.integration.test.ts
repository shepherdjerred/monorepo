import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/common";
import {
  createTestDatabase,
  createApp,
  Delivery,
  seedDelivery,
  testOperator,
  testExecutor,
  workerFixture,
} from "@shepherdjerred/delivery/testing";
import {
  deliverySuccessorWorkflowId,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";

const temporal = vi.hoisted(() => ({
  start: vi.fn((_type: string, _options: unknown): Promise<void> =>
    Promise.resolve(),
  ),
  describe: vi.fn(async (_workflowId: string) => ({
    type: "deliveryDeploymentWorkflow",
    status: { name: "RUNNING" },
  })),
  handles: Array.of<string>(),
}));
vi.mock("#client", () => ({
  createTemporalClient: async () => ({
    workflow: {
      start: temporal.start,
      getHandle: (workflowId: string) => {
        temporal.handles.push(workflowId);
        return { describe: async () => await temporal.describe(workflowId) };
      },
    },
  }),
}));
import { dispatchPendingDeliveries } from "./dispatch.ts";
import { dispatchDeliveryWorkerRecoveries } from "./workers/worker-recovery-dispatch.ts";

async function quarantinedRecovery(store: Delivery) {
  const fixture = await workerFixture(store);
  const old = await fixture.acceptedRelease(1);
  await fixture.adopt(old);
  await fixture.freeze(old);
  const detail = await fixture.requestedFrozenRelease(2);
  await store.claim(detail.deployment.id, testExecutor);
  await store.stage(
    detail.deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "ambiguous-native-operation",
      message: "Receipt lost; quarantine retained",
      evidence: [],
    },
    testExecutor,
  );
  await store.finish(
    detail.deployment.id,
    {
      status: "failed",
      message: "Native operation must be inspected",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const failed = await store.detail(detail.deployment.id);
  const intent = await store.requestWorkerRecovery(
    detail.deployment.id,
    {
      requestId: crypto.randomUUID(),
      expectedEnvironmentGeneration: failed.environment.generation,
      reason:
        "Independent native receipt inspection while ordinary writes are paused",
    },
    testOperator,
  );
  return { detail, intent };
}

/**
 * D8: a handed-off self-hosted deployment gets its one successor instead of
 * an orphan repair, and once the successor owns it the monitor watches it.
 */
async function successorDispatchCase(input: {
  store: Delivery;
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"];
  environmentId: string;
  versionId: string;
}) {
  const { store, database, environmentId, versionId } = input;
  const env = await database.environment.findUniqueOrThrow({
    where: { id: environmentId },
  });
  await database.service.update({
    where: { id: env.serviceId },
    data: { selfHosted: true },
  });
  for (const pending of await database.deployment.findMany({
    where: { environmentId, status: { in: ["queued", "awaiting_approval"] } },
  }))
    await store.cancel(pending.id, testOperator);
  const handed = await store.createDeployment(
    {
      requestId: "self-hosted-handoff",
      environmentId,
      versionSetRevisionId: versionId,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  const outgoing = {
    workflowId: deliveryWorkflowId(handed.id),
    workflowRunId: "outgoing-run",
  };
  await store.claim(handed.id, testExecutor, undefined, outgoing);
  await store.handOff(handed.id, outgoing, testExecutor);
  const successor = deliverySuccessorWorkflowId(handed.id);
  expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
  expect(temporal.start).toHaveBeenCalledWith(
    "deliveryHandoffWorkflow",
    expect.objectContaining({
      workflowId: successor,
      args: [{ deploymentId: handed.id }],
    }),
  );
  expect(temporal.handles).not.toContain(outgoing.workflowId);
  temporal.start.mockRejectedValueOnce(
    new WorkflowExecutionAlreadyStartedError(
      "successor already started",
      successor,
      "deliveryHandoffWorkflow",
    ),
  );
  expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
  expect(
    await database.deployment.findUniqueOrThrow({
      where: { id: handed.id },
    }),
  ).toMatchObject({ status: "running", recoveryRequired: false });
  // Once the successor owns it, the monitor watches the successor.
  await store.claimHandoff(
    handed.id,
    { workflowId: successor, workflowRunId: "successor-run" },
    testExecutor,
  );
  temporal.handles.length = 0;
  temporal.describe.mockImplementation(async (workflowId) => ({
    type:
      workflowId === successor
        ? "deliveryHandoffWorkflow"
        : "deliveryDeploymentWorkflow",
    status: { name: "RUNNING" },
  }));
  try {
    await dispatchPendingDeliveries();
  } finally {
    temporal.describe.mockReset();
    temporal.describe.mockImplementation(async () => ({
      type: "deliveryDeploymentWorkflow",
      status: { name: "RUNNING" },
    }));
  }
  expect(temporal.handles).toContain(successor);
  await store.finish(
    handed.id,
    {
      status: "failed",
      message: "Fixture releases the dispatch barrier",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  await database.service.update({
    where: { id: env.serviceId },
    data: { selfHosted: false },
  });
}

type Fixture = {
  store: Delivery;
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"];
  environmentId: string;
  versionId: string;
};

/** A self-hosted deployment whose outgoing executor applied it and handed it off (D8). */
async function handedOffDeployment(input: Fixture, requestId: string) {
  const { store, database, environmentId, versionId } = input;
  const env = await database.environment.findUniqueOrThrow({
    where: { id: environmentId },
  });
  await database.service.update({
    where: { id: env.serviceId },
    data: { selfHosted: true },
  });
  for (const pending of await database.deployment.findMany({
    where: { environmentId, status: { in: ["queued", "awaiting_approval"] } },
  }))
    await store.cancel(pending.id, testOperator);
  const handed = await store.createDeployment(
    {
      requestId,
      environmentId,
      versionSetRevisionId: versionId,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  const outgoing = {
    workflowId: deliveryWorkflowId(handed.id),
    workflowRunId: "outgoing-run",
  };
  await store.claim(handed.id, testExecutor, undefined, outgoing);
  await store.handOff(handed.id, outgoing, testExecutor);
  return {
    handed,
    serviceId: env.serviceId,
    successor: deliverySuccessorWorkflowId(handed.id),
  };
}

/** Temporal's view of the successor: a handoff Workflow in a status. */
function describeSuccessor(successor: string, status: string) {
  temporal.describe.mockImplementation(async (workflowId) =>
    workflowId === successor
      ? { type: "deliveryHandoffWorkflow", status: { name: status } }
      : { type: "deliveryDeploymentWorkflow", status: { name: "RUNNING" } },
  );
}

function resetDescribe() {
  temporal.describe.mockReset();
  temporal.describe.mockImplementation(async () => ({
    type: "deliveryDeploymentWorkflow",
    status: { name: "RUNNING" },
  }));
}

/**
 * D8: a successor that closes after claiming its handoff leaves the applied
 * self-hosted change unverified. The deployment ends recovery-required,
 * keeping its target locks and its environment.
 */
async function closedSuccessorCase(input: Fixture) {
  const { store, database } = input;
  const { handed, serviceId, successor } = await handedOffDeployment(
    input,
    "successor-closed-after-claim",
  );
  await store.claimHandoff(
    handed.id,
    { workflowId: successor, workflowRunId: "successor-run" },
    testExecutor,
  );
  const locks = await database.targetLock.count({
    where: { deploymentId: handed.id },
  });
  expect(locks).toBeGreaterThan(0);
  describeSuccessor(successor, "TERMINATED");
  try {
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
  } finally {
    resetDescribe();
  }
  const settled = await store.detail(handed.id);
  expect(settled.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: true,
  });
  expect(settled.environment.activeDeploymentId).toBe(handed.id);
  expect(
    await database.targetLock.count({ where: { deploymentId: handed.id } }),
  ).toBe(locks);
  // Fixture cleanup stands in for the recovery intent that would settle it.
  await database.targetLock.deleteMany({ where: { deploymentId: handed.id } });
  await database.platformLock.deleteMany({
    where: { deploymentId: handed.id },
  });
  await database.deployment.update({
    where: { id: handed.id },
    data: { recoveryRequired: false },
  });
  await database.environment.update({
    where: { id: settled.environment.id },
    data: { activeDeploymentId: null },
  });
  await database.service.update({
    where: { id: serviceId },
    data: { selfHosted: false },
  });
}

describe("Delivery outbox dispatch over real PostgreSQL and HTTP", () => {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<typeof Bun.serve>;
  let deploymentId: string;
  let store: Delivery;
  let environmentId: string;
  let versionId: string;
  let writesEnabled = true;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    const delivery = new Delivery(cluster.database);
    store = delivery;
    const fixture = await seedDelivery(delivery);
    environmentId = fixture.environment.id;
    versionId = fixture.versionSet.id;
    const deployment = await delivery.createDeployment(
      {
        requestId: "dispatch-test",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    deploymentId = deployment.id;
    const token = "delivery-executor-integration-test-credential";
    const app = createApp({
      delivery,
      peerAddress: () => "127.0.0.1",
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      qualifyBuild: async () => "verified",
      config: {
        publicOrigin: "http://localhost",
        machineCredentials: [{ token, principal: testExecutor }],
        writesEnabled: async () => writesEnabled,
        enabledEnvironments: async () => [fixture.environment.id],
        operatorLogins: async () => [],
        trustedProxyAddresses: async () => [],
      },
    });
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
    vi.stubEnv("DELIVERY_API_URL", server.url.origin);
    vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", token);
  }, 60_000);
  afterAll(async () => {
    await server.stop(true);
    vi.unstubAllEnvs();
    await cluster.close();
  });

  it("reconciles a lost Temporal start receipt using the shared workflow identity and acknowledges once", async () => {
    temporal.describe.mockRejectedValueOnce(
      new WorkflowNotFoundError(
        "Not started during initial monitor",
        deliveryWorkflowId(deploymentId),
        undefined,
      ),
    );
    temporal.start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "lost start response",
        deliveryWorkflowId(deploymentId),
        "deliveryDeploymentWorkflow",
      ),
    );
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 1 });
    expect(temporal.start).toHaveBeenCalledWith(
      "deliveryDeploymentWorkflow",
      expect.objectContaining({
        workflowId: deliveryWorkflowId(deploymentId),
        args: [{ deploymentId }],
      }),
    );
    expect(temporal.describe).toHaveBeenCalledTimes(2);
    const outbox = await cluster.database.outbox.findUniqueOrThrow({
      where: { deploymentId },
    });
    expect(outbox.submittedAt).not.toBeNull();
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
    expect(temporal.start).toHaveBeenCalledTimes(1);
  }, 60_000);
  it("settles a closed submitted Workflow while mutations are paused, without starting new work", async () => {
    writesEnabled = false;
    temporal.describe.mockResolvedValueOnce({
      type: "deliveryDeploymentWorkflow",
      status: { name: "FAILED" },
    });
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
    const deployment = await cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });
    expect(deployment.status).toBe("failed");
    expect(deployment.recoveryRequired).toBe(false);
    expect(temporal.start).not.toHaveBeenCalled();
  }, 60_000);
  it("repairs a lost unacknowledged start while paused and leaves never-started work queued", async () => {
    writesEnabled = false;
    const request = {
      environmentId,
      versionSetRevisionId: versionId,
      expectedGeneration: 0,
      kind: "deploy" as const,
    };
    const started = await store.createDeployment(
      { ...request, requestId: "lost-start-paused" },
      testOperator,
    );
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
    const acknowledged = await cluster.database.outbox.findUniqueOrThrow({
      where: { deploymentId: started.id },
    });
    expect(acknowledged.submittedAt).not.toBeNull();
    expect(temporal.start).not.toHaveBeenCalled();
    await store.cancel(started.id, testOperator);
    const missing = await store.createDeployment(
      { ...request, requestId: "never-started-paused" },
      testOperator,
    );
    temporal.describe.mockRejectedValueOnce(
      new WorkflowNotFoundError(
        "Never started",
        deliveryWorkflowId(missing.id),
        undefined,
      ),
    );
    expect(await dispatchPendingDeliveries()).toEqual({ submitted: 0 });
    const untouched = await cluster.database.outbox.findUniqueOrThrow({
      where: { deploymentId: missing.id },
    });
    expect(untouched.submittedAt).toBeNull();
    expect(temporal.start).not.toHaveBeenCalled();
  }, 60_000);
  it("starts the one successor of a handed-off self-hosted deployment instead of orphaning it (D8)", async () => {
    writesEnabled = false;
    await successorDispatchCase({
      store,
      database: cluster.database,
      environmentId,
      versionId,
    });
  }, 60_000);
  // Before the worker recovery case, whose quarantine holds the dispatch barrier.
  it("a successor that claims and closes before acceptance never releases ownership (D8)", async () => {
    writesEnabled = false;
    await closedSuccessorCase({
      store,
      database: cluster.database,
      environmentId,
      versionId,
    });
  }, 60_000);
  it("repairs a recovery Workflow's lost start response while paused without starting another attempt", async () => {
    writesEnabled = false;
    const { detail, intent } = await quarantinedRecovery(store);
    temporal.describe.mockResolvedValue({
      type: "deliveryWorkerRecoveryWorkflow",
      status: { name: "RUNNING" },
    });
    temporal.describe.mockRejectedValueOnce(
      new WorkflowNotFoundError(
        "Not observed before lost start",
        intent.workflowId,
        undefined,
      ),
    );
    temporal.start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "Start response lost",
        intent.workflowId,
        "deliveryWorkerRecoveryWorkflow",
      ),
    );
    await dispatchDeliveryWorkerRecoveries();
    expect(temporal.start).toHaveBeenCalledOnce();
    expect(temporal.start).toHaveBeenCalledWith(
      "deliveryWorkerRecoveryWorkflow",
      expect.objectContaining({
        workflowId: intent.workflowId,
        args: [{ intentId: intent.id }],
      }),
    );
    const acknowledged = await store.workerRecovery(intent.id, testExecutor);
    expect(acknowledged.intent.submittedAt).not.toBeNull();
    await dispatchDeliveryWorkerRecoveries();
    expect(temporal.start).toHaveBeenCalledOnce();
    const preserved = await store.detail(detail.deployment.id);
    expect(preserved.deployment.status).toBe("failed");
    expect(preserved.deployment.recoveryRequired).toBe(true);
    expect(preserved.environment.activeDeploymentId).toBe(detail.deployment.id);
  }, 60_000);
});
