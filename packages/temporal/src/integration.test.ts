import { describe, expect, it } from "bun:test";
import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const TEMPORAL_ADDRESS = "localhost:7233";

describe("temporal integration", () => {
  it("connects to local dev server", async () => {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    const client = new Client({ connection });

    // Verify we can list workflows (empty is fine)
    const handle = client.workflow.list();
    const workflows = [];
    for await (const wf of handle) {
      workflows.push(wf);
    }
    // Just verifying the connection works - count doesn't matter
    expect(workflows).toBeDefined();
  });

  it("runs the dns-audit workflow end-to-end", async () => {
    const taskQueue = `test-${crypto.randomUUID()}`;

    // Import activities directly
    const { dnsAuditActivities } = await import("#activities/dns-audit.ts");

    // Start a worker with just the dns-audit activities and workflow
    const worker = await Worker.create({
      connection: await (
        await import("@temporalio/worker")
      ).NativeConnection.connect({
        address: TEMPORAL_ADDRESS,
      }),
      namespace: "default",
      taskQueue,
      workflowsPath: new URL("./workflows/index.ts", import.meta.url).pathname,
      activities: {
        ...dnsAuditActivities,
      },
    });

    // Run the worker in the background
    const workerPromise = worker.run();

    try {
      // Start the workflow via client
      const connection = await Connection.connect({
        address: TEMPORAL_ADDRESS,
      });
      const client = new Client({ connection });

      const handle = await client.workflow.start("runDnsAudit", {
        taskQueue,
        workflowId: `dns-audit-test-${crypto.randomUUID()}`,
      });

      // Wait for completion (should be fast — just DNS lookups)
      const result = await handle.result();
      expect(result).toBeUndefined(); // void workflow

      // Verify the workflow completed
      const description = await handle.describe();
      expect(description.status.name).toBe("COMPLETED");
    } finally {
      worker.shutdown();
      await workerPromise;
    }
  }, 30_000);

  it("runs the vacuum workflow (fails fast without HA)", async () => {
    const taskQueue = `test-${crypto.randomUUID()}`;

    const { haActivities } = await import("#activities/ha.ts");

    const worker = await Worker.create({
      connection: await (
        await import("@temporalio/worker")
      ).NativeConnection.connect({
        address: TEMPORAL_ADDRESS,
      }),
      namespace: "default",
      taskQueue,
      workflowsPath: new URL("./workflows/index.ts", import.meta.url).pathname,
      activities: {
        ...haActivities,
      },
    });

    const workerPromise = worker.run();

    try {
      const connection = await Connection.connect({
        address: TEMPORAL_ADDRESS,
      });
      const client = new Client({ connection });

      const handle = await client.workflow.start("runVacuumIfNotHome", {
        taskQueue,
        workflowId: `vacuum-test-${crypto.randomUUID()}`,
        // Short timeout so the test doesn't wait for all retries
        workflowExecutionTimeout: "5 seconds",
      });

      // Should fail because HA_URL is not set and timeout is short
      await expect(handle.result()).rejects.toThrow();
    } finally {
      worker.shutdown();
      await workerPromise;
    }
  }, 15_000);
});
