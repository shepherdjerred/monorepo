import { Client, Connection } from "@temporalio/client";
import { z } from "zod";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";
import type { workerDeploymentCanaryWorkflow } from "#workflows/index.ts";
import { requiredArgument, requiredEnvironment } from "./cli-arguments.ts";

const ArgumentsSchema = z.object({
  deploymentName: z.string().min(1),
  buildId: WorkerBuildIdSchema,
  namespace: z.string().min(1),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = ArgumentsSchema.parse({
    deploymentName: requiredArgument(args, "--deployment-name"),
    buildId: requiredArgument(args, "--build-id"),
    namespace: requiredArgument(args, "--namespace"),
  });
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
    }),
  );
  const client = new Client({ connection, namespace: input.namespace });
  try {
    const workflowId = `worker-deployment-canary-${input.buildId}-${crypto.randomUUID()}`;
    const handle = await client.workflow.start<
      typeof workerDeploymentCanaryWorkflow
    >("workerDeploymentCanaryWorkflow", {
      workflowId,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [input],
      versioningOverride: {
        pinnedTo: {
          deploymentName: input.deploymentName,
          buildId: input.buildId,
        },
      },
    });
    await handle.result();
    console.warn(
      JSON.stringify({
        deploymentName: input.deploymentName,
        buildId: input.buildId,
        workflowId,
        runId: handle.firstExecutionRunId,
        outcome: "passed",
      }),
    );
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
