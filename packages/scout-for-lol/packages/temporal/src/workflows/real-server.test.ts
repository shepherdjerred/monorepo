import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  Client,
  Connection,
  ScheduleOverlapPolicy,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { SCOUT_WORKFLOW_NAMES, scoutTaskQueues } from "#src/identifiers.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../../../..");
const workflowsPath = new URL("index.ts", import.meta.url).pathname;
const temporalExecutable = execFileSync("mise", ["which", "temporal"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();

type RunningWorkerSet = {
  workers: Worker[];
  runs: Promise<void>[];
};

type TestRuntime = {
  server: ChildProcess;
  connection: Connection;
  nativeConnection: NativeConnection;
  client: Client;
  workers: RunningWorkerSet;
  directory: string;
  address: string;
  port: number;
};

let runtime: TestRuntime | undefined;

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate a local Temporal test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

function startServer(port: number, databasePath: string) {
  return spawn(
    temporalExecutable,
    [
      "--disable-config-file",
      "server",
      "start-dev",
      "--namespace",
      "dev",
      "--headless",
      "--ip",
      "127.0.0.1",
      "--port",
      port.toString(),
      "--db-filename",
      databasePath,
    ],
    {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function connectEventually(
  address: string,
  server: ChildProcess,
): Promise<Connection> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Temporal dev server exited with ${server.exitCode.toString()}`,
      );
    }
    try {
      return await Connection.connect({ address, connectTimeout: 500 });
    } catch (error: unknown) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Temporal dev server did not become ready", {
    cause: lastError,
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Temporal dev server did not stop after SIGTERM"));
    }, 10_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startWorkers(input: {
  connection: NativeConnection;
  reportRuns: string[];
  matchRuns: string[];
  blockMatch: Promise<unknown>;
}): Promise<RunningWorkerSet> {
  const queues = scoutTaskQueues("dev");
  const workers = [
    await Worker.create({
      connection: input.connection,
      namespace: "dev",
      taskQueue: queues.workflow,
      workflowsPath,
    }),
    await Worker.create({
      connection: input.connection,
      namespace: "dev",
      taskQueue: queues.realtime,
      activities: {
        ingestMatch: async (activityInput: { matchId: string }) => {
          input.matchRuns.push(activityInput.matchId);
          await input.blockMatch;
        },
      },
    }),
    await Worker.create({
      connection: input.connection,
      namespace: "dev",
      taskQueue: queues.background,
      activities: {
        runReport: (activityInput: { reportId: string }) => {
          input.reportRuns.push(activityInput.reportId);
        },
      },
    }),
  ];
  const runs = workers.map(async (worker) => {
    await worker.run();
  });
  await Promise.all(
    workers.map(async (worker) => {
      await expect.poll(() => worker.getState()).toBe("RUNNING");
    }),
  );
  return { workers, runs };
}

async function stopWorkers(workerSet: RunningWorkerSet): Promise<void> {
  for (const worker of workerSet.workers) {
    if (worker.getState() === "RUNNING") worker.shutdown();
  }
  await Promise.all(workerSet.runs);
}

afterEach(async () => {
  const active = runtime;
  runtime = undefined;
  if (active === undefined) return;
  await stopWorkers(active.workers);
  await active.nativeConnection.close();
  await active.connection.close();
  await stopServer(active.server);
  await rm(active.directory, { recursive: true });
});

test("real server preserves IDs, catches up Schedules, survives outages, and replays history", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "scout-temporal-real-server-"),
  );
  const port = await unusedPort();
  const address = `127.0.0.1:${port.toString()}`;
  const databasePath = path.join(directory, "temporal.db");
  let server = startServer(port, databasePath);
  let connection = await connectEventually(address, server);
  let nativeConnection = await NativeConnection.connect({ address });
  let client = new Client({ connection, namespace: "dev" });
  const reportRuns: string[] = [];
  const matchRuns: string[] = [];
  const matchGate = Promise.withResolvers<null>();
  let workers = await startWorkers({
    connection: nativeConnection,
    reportRuns,
    matchRuns,
    blockMatch: matchGate.promise,
  });
  const runtimeState: TestRuntime = {
    server,
    connection,
    nativeConnection,
    client,
    workers,
    directory,
    address,
    port,
  };
  runtime = runtimeState;

  const duplicateOptions = {
    workflowId: "scout-dev-match-NA1_4242",
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: scoutTaskQueues("dev").workflow,
    args: [
      {
        stage: "dev",
        matchId: "NA1_4242",
        sourcePuuid: "puuid-real-server",
        region: "AMERICA_NORTH",
        delivery: "live",
      },
    ],
  } as const;
  const first = await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.matchIngestion,
    duplicateOptions,
  );
  await expect.poll(() => matchRuns, { timeout: 20_000 }).toEqual(["NA1_4242"]);
  const duplicate = await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.matchIngestion,
    duplicateOptions,
  );
  expect(duplicate.workflowId).toBe(first.workflowId);
  matchGate.resolve(null);
  await expect(first.result()).resolves.toBe("completed");
  expect(matchRuns).toEqual(["NA1_4242"]);

  const replayHistory = await first.fetchHistory();
  await Worker.runReplayHistory({ workflowsPath }, replayHistory);

  await stopWorkers(workers);
  workers = { workers: [], runs: [] };
  runtimeState.workers = workers;
  const pending = await client.workflow.start(SCOUT_WORKFLOW_NAMES.reportRun, {
    workflowId: "scout-dev-manual-report-worker-restart",
    taskQueue: scoutTaskQueues("dev").workflow,
    args: [
      {
        stage: "dev",
        reportId: "11",
        revision: 1,
        runId: "101",
        source: "manual",
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(reportRuns).toEqual([]);
  workers = await startWorkers({
    connection: nativeConnection,
    reportRuns,
    matchRuns,
    blockMatch: Promise.resolve(),
  });
  runtimeState.workers = workers;
  await expect(pending.result()).resolves.toBe("completed");
  expect(reportRuns).toEqual(["11"]);

  await client.schedule.create({
    scheduleId: "scout-dev-real-server-catchup",
    spec: { intervals: [{ every: 1000 }] },
    action: {
      type: "startWorkflow",
      workflowType: SCOUT_WORKFLOW_NAMES.reportRun,
      taskQueue: scoutTaskQueues("dev").workflow,
      args: [
        {
          stage: "dev",
          reportId: "12",
          revision: 1,
          source: "schedule",
        },
      ],
    },
    policies: {
      overlap: ScheduleOverlapPolicy.BUFFER_ONE,
      catchupWindow: 60_000,
      pauseOnFailure: false,
    },
  });
  await expect
    .poll(() => reportRuns.includes("12"), { timeout: 5000 })
    .toBe(true);

  await stopWorkers(workers);
  workers = { workers: [], runs: [] };
  runtimeState.workers = workers;
  const beforeWorkerOutage = reportRuns.filter((id) => id === "12").length;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  workers = await startWorkers({
    connection: nativeConnection,
    reportRuns,
    matchRuns,
    blockMatch: Promise.resolve(),
  });
  runtimeState.workers = workers;
  await expect
    .poll(() => reportRuns.filter((id) => id === "12").length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(beforeWorkerOutage);
  await client.schedule.getHandle("scout-dev-real-server-catchup").delete();

  // Isolate server-outage catch-up from the buffered action created during the
  // Worker-outage case above. This Schedule's complete publication window is
  // while the server is down, so the only way its action can run is Temporal's
  // persisted catch-up processing after restart.
  const outageWindowStart = new Date(Date.now() + 1000);
  await client.schedule.create({
    scheduleId: "scout-dev-real-server-outage-catchup",
    spec: {
      intervals: [{ every: 1000 }],
      startAt: outageWindowStart,
    },
    action: {
      type: "startWorkflow",
      workflowType: SCOUT_WORKFLOW_NAMES.reportRun,
      taskQueue: scoutTaskQueues("dev").workflow,
      args: [
        {
          stage: "dev",
          reportId: "13",
          revision: 1,
          source: "schedule",
        },
      ],
    },
    policies: {
      overlap: ScheduleOverlapPolicy.BUFFER_ONE,
      catchupWindow: 60_000,
      pauseOnFailure: false,
    },
  });

  await stopWorkers(workers);
  workers = { workers: [], runs: [] };
  runtimeState.workers = workers;
  await nativeConnection.close();
  await connection.close();
  await stopServer(server);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  server = startServer(port, databasePath);
  connection = await connectEventually(address, server);
  nativeConnection = await NativeConnection.connect({ address });
  client = new Client({ connection, namespace: "dev" });
  const restoredSchedule = await client.schedule
    .getHandle("scout-dev-real-server-outage-catchup")
    .describe();
  expect(restoredSchedule.state.paused).toBe(false);
  runtimeState.server = server;
  runtimeState.connection = connection;
  runtimeState.nativeConnection = nativeConnection;
  runtimeState.client = client;
  const beforeServerOutage = reportRuns.filter((id) => id === "13").length;
  workers = await startWorkers({
    connection: nativeConnection,
    reportRuns,
    matchRuns,
    blockMatch: Promise.resolve(),
  });
  runtimeState.workers = workers;
  await expect
    .poll(() => reportRuns.filter((id) => id === "13").length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(beforeServerOutage);
  await client.schedule
    .getHandle("scout-dev-real-server-outage-catchup")
    .delete();
}, 90_000);
