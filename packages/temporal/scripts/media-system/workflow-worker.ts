import { readFile, writeFile } from "node:fs/promises";
import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL(
  "../../src/workflows/media/exports.ts",
  import.meta.url,
).pathname;
const [mode, target, marker] = process.argv.slice(2);
if (mode === "replay") {
  if (target === undefined) throw new Error("Exact history file required");
  await Worker.runReplayHistory(
    { workflowsPath },
    JSON.parse(await readFile(target, "utf8")),
  );
} else if (mode === "run") {
  if (
    target === undefined ||
    marker === undefined ||
    !/^127\.0\.0\.1:\d+$/.test(target)
  )
    throw new Error(
      "An explicit local Temporal address and ready marker are required",
    );
  const connection = await NativeConnection.connect({ address: target });
  try {
    const worker = await Worker.create({
      connection,
      namespace: "dev",
      workflowsPath,
      taskQueue: TASK_QUEUES.WORKFLOWS,
    });
    const running = worker.run();
    await writeFile(marker, "ready\n");
    await running;
  } finally {
    await connection.close();
  }
} else throw new Error("Expected run or replay mode");
