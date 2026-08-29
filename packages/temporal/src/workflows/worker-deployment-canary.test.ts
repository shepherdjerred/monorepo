import { VersioningBehavior } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DEPLOYMENT_NAME = "monorepo-central-workflows";
const BUILD_ID = "d".repeat(40);

async function createCanaryWorker(
  environment: TestWorkflowEnvironment,
): Promise<Worker> {
  return await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    workerDeploymentOptions: {
      version: { deploymentName: DEPLOYMENT_NAME, buildId: BUILD_ID },
      useWorkerVersioning: true,
      defaultVersioningBehavior: VersioningBehavior.AUTO_UPGRADE,
    },
  });
}

describe("workerDeploymentCanaryWorkflow", () => {
  test("proves an exact pinned Worker Deployment version", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await createCanaryWorker(environment);
    try {
      await worker.runUntil(
        environment.client.workflow.execute("workerDeploymentCanaryWorkflow", {
          workflowId: `worker-deployment-canary-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ deploymentName: DEPLOYMENT_NAME, buildId: BUILD_ID }],
          versioningOverride: {
            pinnedTo: {
              deploymentName: DEPLOYMENT_NAME,
              buildId: BUILD_ID,
            },
          },
        }),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("fails when the requested identity differs from the executing version", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await createCanaryWorker(environment);
    try {
      await expect(
        worker.runUntil(
          environment.client.workflow.execute(
            "workerDeploymentCanaryWorkflow",
            {
              workflowId: `worker-deployment-canary-mismatch-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [
                {
                  deploymentName: DEPLOYMENT_NAME,
                  buildId: "e".repeat(40),
                },
              ],
              versioningOverride: {
                pinnedTo: {
                  deploymentName: DEPLOYMENT_NAME,
                  buildId: BUILD_ID,
                },
              },
            },
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
