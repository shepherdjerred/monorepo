import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createMovieHistoryReviewWorkflowFixture } from "@shepherdjerred/media/testing/movie-history-review-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { createPlexBoundConsumerActivities } from "#activities/media/plex-consumers.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import {
  assertPrivateHistory,
  assertScopedMovieRetentionActivityBudgets,
} from "#activities/media/testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Scenario = Awaited<
  ReturnType<typeof createMovieHistoryReviewWorkflowFixture>
>;
type Evidence = Awaited<ReturnType<Scenario["evidence"]>>;

test("real authenticated household release dispatches named retention through separate roles, keeps original ownership, and replays both histories", async () => {
  const { node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-history-review-role-"),
  );
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const script = new URL(
    "../../../../scripts/media-system/workflow-worker.ts",
    import.meta.url,
  ).pathname;
  const runtimePath = Bun.env["PATH"];
  if (runtimePath === undefined || runtimePath.length === 0)
    throw new Error("Pinned runtime PATH required");
  const childEnvironment = { PATH: runtimePath };
  let scenario: Scenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  const starts = new Map<string, string>();
  try {
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
      namespace: "default",
    });
    scenario = await createMovieHistoryReviewWorkflowFixture(async (start) => {
      if (start.workflowType !== "retainMovieEditionV4Workflow")
        throw new Error(
          "Independent operations remain queued for their actual workers",
        );
      const operationId = start.input["operationId"];
      if (typeof operationId !== "string")
        throw new TypeError(
          "Actual release outbox omitted its operation identity",
        );
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
      starts.set(operationId, start.workflowId);
    });
    const f = scenario;
    const initial = await f.evidence();
    expect(initial.review.state).toBe("released");
    expect(initial.hold.releasedAt).toBeInstanceOf(Date);
    expect(initial.asset).toEqual(f.baseline.asset);
    expect(initial.library.checksum).not.toBeNull();
    expect(initial.decision).toBeNull();
    const load = async () => {
      await f.advancePolicyFromActualState();
      return f;
    };
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        ...createMovieNetworkWorkerActivitiesV4(load),
        ...createPlexBoundConsumerActivities(load),
        finishMediaOperation: f.finishMediaOperation,
      },
    });
    workers.push(network);
    running.push(network.run());
    const files = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: createMovieFileWorkerActivitiesV4(async () => {
        const current = await load();
        return { movie: current.fileMovie };
      }),
    });
    workers.push(files);
    running.push(files.run());
    await waitFor(f, (evidence) => evidence.warnings.length === 1);
    const warningIds = await f.warningOperationIds();
    expect(warningIds).toHaveLength(1);
    const dispatched = await f.dispatch(async (start) => {
      const operationId = start.input["operationId"];
      if (typeof operationId !== "string" || !warningIds.includes(operationId))
        throw new Error(
          "Only this actual scoped warning may dispatch in the scenario",
        );
      expect(start.workflowType).toBe("deliverMediaNotificationWorkflow");
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
      starts.set(operationId, start.workflowId);
    });
    expect(dispatched.dispatched).toBe(1);
    const accepted = await waitFor(f, (evidence) =>
      evidence.warnings.every((row) => row.state === "accepted"),
    );
    expect(accepted.messages).toHaveLength(1);
    expect(accepted.warnings[0]?.acceptedAt?.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    await environment.sleep("1 minute");
    const quarantined = await waitFor(
      f,
      (evidence) => evidence.decision?.state === "quarantined",
    );
    expect(quarantined.library.checksum).toBeNull();
    expect(quarantined.quarantine).toHaveLength(1);
    expect(quarantined.quarantine[0]?.checksum).toBe(initial.library.checksum);
    expect(quarantined.decision?.quarantinedAt?.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(quarantined.journals).toHaveLength(1);
    await environment.sleep("8 days");
    const final = await waitFor(
      f,
      (evidence) => evidence.operation.status === "completed",
    );
    expect(final.decision?.state).toBe("purged");
    expect(final.asset.state).toBe("purged");
    expect(final.asset.plexPublishedAt).toEqual(initial.asset.plexPublishedAt);
    expect(final.quarantine.every((file) => file.checksum === null)).toBe(true);
    expect(final.journals).toHaveLength(2);
    expect(final.handoff).toEqual(initial.handoff);
    expect(final.review).toEqual(initial.review);
    expect(final.receipt).toEqual(initial.receipt);
    expect(final.hold).toEqual(initial.hold);
    expect(final.choice).toEqual(f.choice);
    expect(final.request).toEqual(f.request);
    expect(final.additions).toBe(0);
    expect(final.httpErrors).toEqual([]);
    expect(starts.size).toBe(2);
    for (const [operationId, workflowId] of starts) {
      const handle = environment.client.workflow.getHandle(workflowId);
      expect(await handle.result()).toEqual({ status: "completed" });
      const native = await handle.describe();
      expect(native.workflowId).toBe(`media-operation-${operationId}`);
      expect(native.runId).toBeTruthy();
      expect(native.status.name).toBe("COMPLETED");
      const history = await handle.fetchHistory();
      assertScopedMovieRetentionActivityBudgets(
        history,
        operationId === f.input.operationId ? "retention" : "warning",
      );
      await replay(historyToJSON(history), {
        node,
        script,
        directory,
        childEnvironment,
        name: operationId,
      });
    }
  } finally {
    try {
      for (const worker of workers) worker.shutdown();
      await Promise.all(running);
    } finally {
      try {
        if (workflow !== undefined) {
          workflow.kill("SIGTERM");
          await workflow.exited;
        }
      } finally {
        try {
          await scenario?.close();
        } finally {
          await environment.teardown();
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }
}, 60_000);

async function waitFor(
  scenario: Scenario,
  ready: (evidence: Evidence) => boolean,
) {
  const deadline = performance.now() + 20_000;
  for (;;) {
    const evidence = await scenario.evidence();
    if (ready(evidence)) return evidence;
    if (evidence.operation.status === "reconciling")
      throw new Error(
        `Actual HTTP retention stopped: ${JSON.stringify(evidence.operation.result)}`,
      );
    if (performance.now() >= deadline)
      throw new Error(
        `Actual HTTP retention milestone did not settle: ${evidence.operation.status}/${evidence.decision?.state ?? "none"}`,
      );
    await Bun.sleep(25);
  }
}

async function replay(
  history: string,
  options: {
    node: string;
    script: string;
    directory: string;
    childEnvironment: { PATH: string };
    name: string;
  },
) {
  assertPrivateHistory(history, [
    "Synthetic Film",
    "synthetic-history-http",
    "caption-owner@example.test",
    "/data/movies",
    "/downloads",
    "movie_history_review_captured_v3",
    "claimAcknowledgements",
  ]);
  const filename = path.join(options.directory, `${options.name}.json`);
  await Bun.write(filename, history);
  const process = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "replay",
      filename,
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, , error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(exitCode, error).toBe(0);
}
