import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "./shared/task-queues.ts";
import { registerSchedules } from "./schedules/register-schedules.ts";
import { activities } from "./activities/index.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

async function main(): Promise<void> {
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  console.warn(`Connecting to Temporal server at ${address}`);

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowsPath: new URL("workflows/index.ts", import.meta.url).pathname,
    activities,
  });

  console.warn(`Worker started on task queue "${TASK_QUEUES.DEFAULT}"`);

  // Share the same connection for schedule registration
  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection });
  await registerSchedules(client);
  console.warn("Schedules registered");

  // Start processing
  await worker.run();
}

void (async () => {
  try {
    await main();
  } catch (error: unknown) {
    console.error("Worker failed:", error);
    process.exit(1);
  }
})();
