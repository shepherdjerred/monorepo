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
} from "@shepherdjerred/delivery/testing";
import { deliveryWorkflowId } from "@shepherdjerred/delivery/contract";

const temporal = vi.hoisted(() => ({
  start: vi.fn((_type: string, _options: unknown): Promise<void> =>
    Promise.resolve(),
  ),
  describe: vi.fn(async () => ({
    type: "deliveryDeploymentWorkflow",
    status: { name: "RUNNING" },
  })),
}));
vi.mock("#client", () => ({
  createTemporalClient: async () => ({
    workflow: {
      start: temporal.start,
      getHandle: () => ({ describe: temporal.describe }),
    },
  }),
}));
import { dispatchPendingDeliveries } from "./dispatch.ts";

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
});
