import { readFile, writeFile } from "node:fs/promises";
import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const PARENT_LOSS_FORCE_EXIT_MS = 5000;
const PARENT_WATCHDOG_INTERVAL_MS = 1000;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function watchParentLifetime(onParentLost: () => void): () => void {
  const initialParentPid = process.ppid;
  let triggered = false;
  const trigger = (): void => {
    if (triggered) {
      return;
    }
    triggered = true;
    onParentLost();
  };

  const watchStdin = !process.stdin.isTTY;
  if (watchStdin) {
    process.stdin.once("end", trigger);
    process.stdin.once("close", trigger);
    process.stdin.once("error", trigger);
    process.stdin.resume();
  }

  const watchdog = setInterval(() => {
    if (
      process.ppid !== initialParentPid ||
      process.ppid <= 1 ||
      !isPidAlive(initialParentPid)
    ) {
      trigger();
    }
  }, PARENT_WATCHDOG_INTERVAL_MS);
  watchdog.unref();

  return (): void => {
    clearInterval(watchdog);
    if (watchStdin) {
      process.stdin.removeListener("end", trigger);
      process.stdin.removeListener("close", trigger);
      process.stdin.removeListener("error", trigger);
      process.stdin.pause();
      process.stdin.unref();
    }
  };
}

async function runWorkflowWorker(
  target: string | undefined,
  marker: string | undefined,
  namespace: string,
  workflowsPath: string,
): Promise<void> {
  if (
    target === undefined ||
    marker === undefined ||
    !/^127\.0\.0\.1:\d+$/u.test(target) ||
    !["dev", "default"].includes(namespace)
  ) {
    throw new Error(
      "An explicit local Temporal address and ready marker are required",
    );
  }

  const parentWatchState: {
    lost: boolean;
    activeWorker: Worker | undefined;
    forceExitTimer: ReturnType<typeof setTimeout> | undefined;
  } = {
    lost: false,
    activeWorker: undefined,
    forceExitTimer: undefined,
  };

  const isParentLost = (): boolean => parentWatchState.lost;

  const stopParentWatch = watchParentLifetime(() => {
    parentWatchState.lost = true;
    const timer = setTimeout(() => {
      process.exit(0);
    }, PARENT_LOSS_FORCE_EXIT_MS);
    timer.unref();
    parentWatchState.forceExitTimer = timer;
    if (parentWatchState.activeWorker !== undefined) {
      try {
        parentWatchState.activeWorker.shutdown();
      } catch {
        // Worker may already be stopping; the unref'd timer bounds any hang.
      }
    }
  });

  try {
    const connection = await NativeConnection.connect({ address: target });
    try {
      const worker = await Worker.create({
        connection,
        namespace,
        workflowsPath,
        taskQueue: TASK_QUEUES.WORKFLOWS,
      });
      parentWatchState.activeWorker = worker;
      if (isParentLost()) {
        return;
      }
      const running = worker.run();
      await writeFile(marker, "ready\n");
      if (isParentLost()) {
        worker.shutdown();
      }
      await running;
    } finally {
      await connection.close();
    }
  } finally {
    stopParentWatch();
    if (parentWatchState.forceExitTimer !== undefined) {
      clearTimeout(parentWatchState.forceExitTimer);
    }
  }
}

const workflowsPath = new URL(
  "../../src/workflows/media/exports.ts",
  import.meta.url,
).pathname;
const [mode, target, marker, namespace = "dev"] = process.argv.slice(2);
if (mode === "replay") {
  if (target === undefined) {
    throw new Error("Exact history file required");
  }
  await Worker.runReplayHistory(
    { workflowsPath },
    JSON.parse(await readFile(target, "utf8")),
  );
} else if (mode === "run") {
  await runWorkflowWorker(target, marker, namespace, workflowsPath);
} else {
  throw new Error("Expected run or replay mode");
}
