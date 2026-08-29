import { describe, expect, it } from "vitest";
import { Client, Connection } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  type WorkerOptions,
} from "@temporalio/worker";
import { TASK_QUEUES, type TaskQueue } from "#shared/task-queues.ts";

const TEMPORAL_ADDRESS = "localhost:7233";

async function runWithDomainActivityWorker(
  activityTaskQueue: TaskQueue,
  activities: NonNullable<WorkerOptions["activities"]>,
  run: (client: Client, workflowTaskQueue: string) => Promise<void>,
): Promise<void> {
  const workflowTaskQueue = `test-${crypto.randomUUID()}`;
  const nativeConnection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });
  const clientConnection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });
  const workflowWorker = await Worker.create({
    connection: nativeConnection,
    namespace: "default",
    taskQueue: workflowTaskQueue,
    workflowsPath: new URL("workflows/index.ts", import.meta.url).pathname,
  });
  const activityWorker = await Worker.create({
    connection: nativeConnection,
    namespace: "default",
    taskQueue: activityTaskQueue,
    activities,
  });
  const workflowWorkerRun = workflowWorker.run();
  const activityWorkerRun = activityWorker.run();

  try {
    await run(new Client({ connection: clientConnection }), workflowTaskQueue);
  } finally {
    workflowWorker.shutdown();
    activityWorker.shutdown();
    await Promise.all([workflowWorkerRun, activityWorkerRun]);
    await clientConnection.close();
    await nativeConnection.close();
  }
}

describe("temporal integration", () => {
  it("connects to local dev server", async () => {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    try {
      const client = new Client({ connection });

      // Verify we can list workflows (empty is fine)
      const handle = client.workflow.list();
      const workflows = [];
      for await (const workflow of handle) {
        workflows.push(workflow);
      }
      // Just verifying the connection works - count doesn't matter
      expect(workflows).toBeDefined();
    } finally {
      await connection.close();
    }
  });

  it("runs the dns-audit workflow end-to-end", async () => {
    const { dnsAuditActivities } = await import("#activities/dns-audit.ts");
    await runWithDomainActivityWorker(
      TASK_QUEUES.INFRA,
      dnsAuditActivities,
      async (client, workflowTaskQueue) => {
        const handle = await client.workflow.start("runDnsAudit", {
          taskQueue: workflowTaskQueue,
          workflowId: `dns-audit-test-${crypto.randomUUID()}`,
        });

        // Wait for completion (should be fast — just DNS lookups)
        const result = await handle.result();
        expect(result).toBeUndefined(); // void workflow

        // Verify the workflow completed
        const description = await handle.describe();
        expect(description.status.name).toBe("COMPLETED");
      },
    );
  }, 30_000);

  it("runs the vacuum workflow (fails fast without HA)", async () => {
    const { haActivities } = await import("#activities/ha.ts");
    await runWithDomainActivityWorker(
      TASK_QUEUES.HOME,
      haActivities,
      async (client, workflowTaskQueue) => {
        const handle = await client.workflow.start("runVacuumIfNotHome", {
          taskQueue: workflowTaskQueue,
          workflowId: `vacuum-test-${crypto.randomUUID()}`,
          // Short timeout so the test doesn't wait for all retries
          workflowExecutionTimeout: "5 seconds",
        });

        // Should fail because HA_URL is not set and timeout is short
        await expect(handle.result()).rejects.toThrow();
      },
    );
  }, 15_000);
});
