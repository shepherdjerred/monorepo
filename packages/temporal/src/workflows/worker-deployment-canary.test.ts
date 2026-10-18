import { VersioningBehavior } from "@temporalio/common";
import { execFileSync } from "node:child_process";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DEPLOYMENT_NAME = "monorepo-central-workflows";
const BUILD_ID = "d".repeat(40);

function executeCanary(
  environment: TestWorkflowEnvironment,
  buildId = BUILD_ID,
  pinned = true,
) {
  return environment.client.workflow.execute("workerDeploymentCanaryWorkflow", {
    workflowId: `worker-deployment-canary-${crypto.randomUUID()}`,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    args: [{ deploymentName: DEPLOYMENT_NAME, buildId }],
    ...(pinned
      ? {
          versioningOverride: {
            pinnedTo: { deploymentName: DEPLOYMENT_NAME, buildId: BUILD_ID },
          },
        }
      : {}),
  });
}

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
      await worker.runUntil(executeCanary(environment));
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("fails when the requested identity differs from the executing version", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await createCanaryWorker(environment);
    try {
      await expect(
        worker.runUntil(executeCanary(environment, "e".repeat(40))),
      ).rejects.toThrow("Workflow execution failed");
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("normal routing reaches and verifies the current Worker Deployment version", async () => {
    const environment = await TestWorkflowEnvironment.createLocal({
      server: {
        executable: {
          type: "existing-path",
          path: execFileSync("mise", ["which", "temporal"], {
            encoding: "utf8",
          }).trim(),
        },
      },
    });
    const worker = await createCanaryWorker(environment);
    try {
      await worker.runUntil(async () => {
        await expect
          .poll(
            async () => {
              const description =
                await environment.client.connection.workflowService.describeWorkerDeploymentVersion(
                  {
                    namespace: "default",
                    deploymentVersion: {
                      deploymentName: DEPLOYMENT_NAME,
                      buildId: BUILD_ID,
                    },
                  },
                );
              return JSON.stringify(description);
            },
            { timeout: 20_000 },
          )
          .toContain(BUILD_ID);
        // A pinned start establishes the real version and its poller first.
        await executeCanary(environment);
        await environment.client.connection.workflowService.setWorkerDeploymentCurrentVersion(
          {
            namespace: "default",
            deploymentName: DEPLOYMENT_NAME,
            buildId: BUILD_ID,
            identity: "canary-test",
          },
        );
        await executeCanary(environment, BUILD_ID, false);
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
