import { createHash } from "node:crypto";
import path from "node:path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { Worker } from "@temporalio/worker";
import { Context, heartbeat } from "@temporalio/activity";
import { z } from "zod";
import {
  createMediaSystemSandbox,
  createMediaWorkflowStarter,
} from "@shepherdjerred/media/testing/system";
import { watchExecution } from "#activities/media/watch-execution.ts";
import { compensationExecution } from "#activities/media/compensation-execution.ts";
import { plexBindingExecution } from "#activities/media/plex-binding-execution.ts";
import { createPlexBindingNetworkActivities } from "#activities/media/plex-binding.ts";
import { createPlexPublicationActivities } from "#activities/media/plex-publication.ts";
import { createPlexBoundConsumerActivities } from "#activities/media/plex-consumers.ts";
import { createPlexCleanupActivities } from "#activities/media/plex-cleanup.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const temporal = Bun.which("temporal");
const arguments_ = Bun.argv.slice(2);
if (arguments_.some((argument) => argument !== "--inspect-ui"))
  throw new Error("Only --inspect-ui is supported");
const inspectUi = arguments_.includes("--inspect-ui");
if (temporal === null) throw new Error("Pinned Temporal CLI is required");
const nodeResolution = Bun.spawnSync(["mise", "which", "node"], {
  stdout: "pipe",
  stderr: "inherit",
});
if (nodeResolution.exitCode !== 0)
  throw new Error("Pinned Node resolution failed");
const node = nodeResolution.stdout.toString().trim();
const environment = await TestWorkflowEnvironment.createLocal({
  server: {
    executable: { type: "existing-path", path: temporal },
    ip: "127.0.0.1",
    namespace: "dev",
    ui: false,
  },
});
const address = environment.address.replace(/^localhost:/, "127.0.0.1:");
const starter = createMediaWorkflowStarter({ address, namespace: "dev" });
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stop.abort(new Error("System acceptance interrupted"));
  });
let sandbox: Awaited<ReturnType<typeof createMediaSystemSandbox>> | undefined;
let workflow: Bun.Subprocess | undefined;
const workers: Worker[] = [];
const runs: Promise<void>[] = [];
const failures: unknown[] = [];
try {
  sandbox = await createMediaSystemSandbox({
    startWorkflow: starter.start,
    describeWorkflow: starter.describe,
    watchExecution,
    plexBindingExecution,
    compensationExecution,
    ui: inspectUi,
    checkpoint: (phase) => {
      heartbeat({ phase });
      return Promise.resolve();
    },
  });
  const scenario = sandbox;
  stop.signal.throwIfAborted();
  const script = new URL("workflow-worker.ts", import.meta.url).pathname;
  const marker = path.join(scenario.root, "workflow.ready");
  // The Workflow process receives no application, provider, or vault credentials.
  const workflowEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
  workflow = Bun.spawn(
    [node, "--experimental-strip-types", script, "run", address, marker],
    {
      env: workflowEnvironment,
      stdin: "ignore",
      stdout: Bun.file(path.join(scenario.root, "workflow.log")),
      stderr: Bun.file(path.join(scenario.root, "workflow-errors.log")),
    },
  );
  const end = performance.now() + 30_000;
  while (!(await Bun.file(marker).exists())) {
    stop.signal.throwIfAborted();
    if (workflow.exitCode !== null || performance.now() >= end)
      throw new Error(
        `Workflow worker did not become ready; inspect ${scenario.root}`,
      );
    await Bun.sleep(100);
  }
  const load = () => Promise.resolve(scenario.facets);
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    maxConcurrentActivityTaskExecutions: 4,
    interceptors: {
      activity: [
        () => ({
          inbound: {
            execute: async (input, next) => {
              const info = Context.current().info;
              if (info.activityType === "publishRolledBackMedia")
                await Bun.write(
                  path.join(scenario.root, "sdk-deadlines.json"),
                  JSON.stringify(
                    {
                      scheduledTimestampMs: info.scheduledTimestampMs,
                      currentAttemptScheduledTimestampMs:
                        info.currentAttemptScheduledTimestampMs,
                      startToCloseTimeoutMs: info.startToCloseTimeoutMs,
                      scheduleToCloseTimeoutMs: info.scheduleToCloseTimeoutMs,
                    },
                    null,
                    2,
                  ),
                );
              return next(input);
            },
          },
        }),
      ],
    },
    activities: {
      ...scenario.network,
      ...createPlexBindingNetworkActivities(load),
      ...createPlexPublicationActivities(load),
      ...createPlexBoundConsumerActivities(load),
      ...createPlexCleanupActivities(load),
    },
  });
  workers.push(network);
  runs.push(network.run());
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    maxConcurrentActivityTaskExecutions: 1,
    activities: scenario.files,
  });
  workers.push(files);
  runs.push(files.run());
  const requested = await scenario.request();
  const handle = environment.client.workflow.getHandle(
    `media-operation-${requested.operationId}`,
  );
  const state: { settled: boolean; outcome?: unknown; failure?: unknown } = {
    settled: false,
  };
  const completion = (async () => {
    try {
      state.outcome = await handle.result();
    } catch (error) {
      state.failure = error;
    } finally {
      state.settled = true;
    }
  })();
  const deadline = performance.now() + 180_000;
  let lastAuthority = 0;
  let connected = false;
  while (!state.settled) {
    stop.signal.throwIfAborted();
    if (performance.now() >= deadline)
      throw new Error(
        `System workflow deadline expired; inspect ${scenario.root}`,
      );
    if (performance.now() - lastAuthority > 15_000) {
      await scenario.refreshAuthority();
      lastAuthority = performance.now();
    }
    if (!connected) {
      await scenario.peers.download.client.login();
      const observed = await scenario.peers.download.client.observe(
        scenario.fixture.infoHash,
      );
      if (observed !== null) {
        await scenario.connectPeer();
        connected = true;
      }
    }
    await Bun.sleep(250);
  }
  await completion;
  if (state.failure !== undefined)
    throw new Error("System workflow failed", { cause: state.failure });
  await Bun.write(
    path.join(scenario.root, "outcome.json"),
    JSON.stringify(
      {
        outcome: state.outcome,
        candidates: await scenario.db.releaseCandidate.findMany({
          select: { title: true, attributes: true, evaluation: true },
        }),
        attempts: await scenario.db.acquisitionAttempt.findMany({
          select: { id: true, state: true, failure: true },
        }),
        operation: await scenario.db.operation.findUniqueOrThrow({
          where: { id: requested.operationId },
          select: { status: true, result: true },
        }),
      },
      null,
      2,
    ),
  );
  const outcome = z
    .object({ status: z.literal("completed") })
    .parse(state.outcome);
  const assets = await scenario.db.libraryAsset.findMany({
    where: {
      coverage: { some: { mediaId: requested.mediaId, current: true } },
    },
  });
  if (assets.length !== 1 || assets[0] === undefined)
    throw new Error("System journey did not publish exactly one current asset");
  const published = new Uint8Array(
    await Bun.file(scenario.mapping.local(assets[0].path)).arrayBuffer(),
  );
  if (
    createHash("sha256").update(published).digest("hex") !==
    scenario.fixture.sha256
  )
    throw new Error("Published bytes differ from the generated input");
  if (scenario.http.errors.length > 0)
    throw new AggregateError(
      scenario.http.errors,
      "Application errors during system journey",
    );
  const available = await requested.available(assets[0].id);
  await Bun.write(
    path.join(scenario.root, "available.json"),
    JSON.stringify(available, null, 2),
  );
  const attempts = await scenario.db.acquisitionAttempt.findMany({
    where: { operationId: requested.operationId },
    select: { id: true },
  });
  const workflowIds = [
    handle.workflowId,
    ...attempts.map((attempt) => `media-acquire-${attempt.id}`),
  ];
  for (const workflowId of workflowIds) {
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    const historyPath = path.join(scenario.root, `${workflowId}.history.json`);
    await Bun.write(historyPath, historyToJSON(history));
    const replay = Bun.spawn(
      [node, "--experimental-strip-types", script, "replay", historyPath],
      {
        env: workflowEnvironment,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if ((await replay.exited) !== 0)
      throw new Error("Actual system workflow history did not replay");
  }
  await Bun.write(
    path.join(scenario.root, "result.json"),
    JSON.stringify(
      {
        outcome,
        mediaId: requested.mediaId,
        operationId: requested.operationId,
        image: scenario.peers.image,
        assetId: assets[0].id,
        sha256: scenario.fixture.sha256,
        replayedWorkflowIds: workflowIds,
        evidence:
          "real HTTP/PG/outbox/Temporal/Bun role queues/qBittorrent/ffprobe/files; synthetic external identity/catalog/provider/PMS and ownership authority; no production or live PMS acceptance",
      },
      null,
      2,
    ),
  );
  if (inspectUi) {
    const ui = {
      origin: scenario.http.origin,
      mediaId: requested.mediaId,
      root: scenario.root,
    };
    await Bun.write(
      path.join(scenario.root, "ui.json"),
      JSON.stringify(ui, null, 2),
    );
    process.stdout.write(JSON.stringify({ readyForInspection: ui }) + "\n");
    while (!stop.signal.aborted) await Bun.sleep(100);
    if (scenario.http.errors.length > 0)
      throw new AggregateError(
        scenario.http.errors,
        "Application errors during mounted UI inspection",
      );
  }
} catch (error) {
  failures.push(error);
} finally {
  for (const worker of workers)
    if (worker.getState() === "RUNNING") worker.shutdown();
  await Promise.allSettled(runs);
  if (workflow !== undefined) {
    workflow.kill("SIGTERM");
    await workflow.exited;
  }
  const cleanup = await Promise.allSettled([
    starter.close(),
    sandbox?.close(),
    environment.teardown(),
  ]);
  for (const result of cleanup)
    if (result.status === "rejected") failures.push(result.reason);
}
if (failures.length > 0)
  throw new AggregateError(failures, "System acceptance failed");
process.stdout.write(
  JSON.stringify({ passed: true, root: sandbox?.root }) + "\n",
);
