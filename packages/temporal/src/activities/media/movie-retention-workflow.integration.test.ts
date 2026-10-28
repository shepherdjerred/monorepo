import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { z } from "zod";
import { createMovieRetentionWorkflowFixture } from "@shepherdjerred/media/testing/movie-retention-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./movie-editions.ts";
import { createPlexBoundConsumerActivities } from "./plex-consumers.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import {
  assertPrivateHistory,
  assertScopedMovieRetentionActivityBudgets,
} from "./testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Scenario = Awaited<ReturnType<typeof createMovieRetentionWorkflowFixture>>;
type Evidence = Awaited<ReturnType<Scenario["evidence"]>>;

test.each([
  "default",
  "directors_cut",
  "extended_cut",
  "theatrical_cut",
  "final_cut",
  "unrated_cut",
  "uncut_version",
] as const)(
  "actual separate role workers warn, quarantine and purge %s with real clocks and original receipts, then replay",
  async (edition) => {
    const { node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-movie-retention-role-"),
    );
    // The SDK test server advances durable timers; Activity/SQL/file clocks remain the actual wall clock.
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let fixture: Scenario | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createMovieRetentionWorkflowFixture(edition);
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.decision).toBeNull();
      expect(initial.library).toHaveLength(3);
      expect(initial.library.every((file) => file.checksum !== null)).toBe(
        true,
      );
      const script = new URL(
        "../../../scripts/media-system/workflow-worker.ts",
        import.meta.url,
      ).pathname;
      const runtimePath = Bun.env["PATH"];
      if (runtimePath === undefined || runtimePath.length === 0)
        throw new Error("Pinned runtime PATH required");
      const childEnvironment = { PATH: runtimePath };
      workflow = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
        namespace: "default",
      });
      const load = async () => {
        await scenario.advancePolicyFromActualState();
        return scenario;
      };
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...createMovieNetworkWorkerActivitiesV4(load),
          ...createPlexBoundConsumerActivities(load),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: createMovieFileWorkerActivitiesV4(async () => {
          const loaded = await load();
          return { movie: loaded.fileMovie };
        }),
      });
      workers.push(files);
      running.push(files.run());
      const starts = new Map<string, string>();
      await dispatchRoleOperations(
        scenario,
        environment,
        [scenario.input.operationId],
        starts,
      );
      await waitForEvidence(
        scenario,
        (evidence) => evidence.deliveries.length === 1,
      );
      const notificationIds = await scenario.warningOperationIds();
      expect(notificationIds).toHaveLength(1);
      await dispatchRoleOperations(
        scenario,
        environment,
        notificationIds,
        starts,
      );
      const accepted = await waitForEvidence(scenario, (evidence) =>
        evidence.deliveries.every((delivery) => delivery.state === "accepted"),
      );
      expect(accepted.deliveries).toHaveLength(1);
      expect(accepted.deliveries[0]?.acceptedAt?.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(accepted.decision?.state).toBe("warning_pending");
      expect(accepted.journals).toEqual([]);
      // This releases the original warning timer without changing its literal wakeAt/result.
      await environment.sleep("1 minute");
      const quarantined = await waitForEvidence(
        scenario,
        (evidence) => evidence.decision?.state === "quarantined",
      );
      assertActualQuarantine(initial, quarantined);
      // Test-server time advances; policy progression independently uses the actual committed quarantine.
      await environment.sleep("8 days");
      const final = await waitForEvidence(
        scenario,
        (evidence) => evidence.operation.status === "completed",
      );
      assertActualPurge(initial, quarantined, final);
      for (const [operationId, workflowId] of starts) {
        const handle = environment.client.workflow.getHandle(workflowId);
        expect(
          await environment.client.connection.withDeadline(
            Date.now() + 20_000,
            () => handle.result(),
          ),
        ).toEqual({ status: "completed" });
        const history = await handle.fetchHistory();
        assertScopedMovieRetentionActivityBudgets(
          history,
          operationId === scenario.input.operationId ? "retention" : "warning",
        );
        await replayRetentionHistory(historyToJSON(history), {
          node,
          script,
          directory,
          childEnvironment,
          name: operationId,
        });
      }
    } finally {
      try {
        try {
          for (const worker of workers) worker.shutdown();
          await Promise.all(running);
        } finally {
          if (workflow !== undefined) {
            workflow.kill("SIGTERM");
            await workflow.exited;
          }
        }
      } finally {
        try {
          await fixture?.close();
        } finally {
          await environment.teardown();
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  },
  60_000,
);

function assertActualQuarantine(initial: Evidence, quarantined: Evidence) {
  expect(quarantined.asset).toMatchObject({
    state: "quarantined",
    edition: initial.asset.edition,
  });
  expect(quarantined.library.every((file) => file.checksum === null)).toBe(
    true,
  );
  const checksums = (evidence: Evidence, location: "library" | "quarantined") =>
    evidence[location]
      .map((file) => file.checksum)
      .sort((a, b) => String(a).localeCompare(String(b)));
  expect(checksums(quarantined, "quarantined")).toEqual(
    checksums(initial, "library"),
  );
  expect(quarantined.journals).toHaveLength(3);
  expect(
    quarantined.journals.every(
      (journal) =>
        journal.kind === "quarantine" && journal.phase === "complete",
    ),
  ).toBe(true);
  expect(quarantined.decision?.quarantinedAt?.getTime()).toBeLessThanOrEqual(
    Date.now(),
  );
  expect(quarantined.decision?.purgeAfter?.getTime()).toBe(
    (quarantined.decision?.quarantinedAt?.getTime() ?? Infinity) +
      7 * 86_400_000,
  );
  expect(quarantined.operation.status).not.toBe("completed");
  expect(quarantined.binding.evidenceId).toBeNull();
}

function assertActualPurge(
  initial: Evidence,
  quarantined: Evidence,
  final: Evidence,
) {
  expect(final.decision?.state).toBe("purged");
  expect(final.asset).toMatchObject({
    state: "purged",
    edition: initial.asset.edition,
    version: initial.asset.version + 2,
  });
  expect(final.asset.coverage.every((coverage) => !coverage.current)).toBe(
    true,
  );
  expect(final.target.availability).toBe("removed");
  expect(final.library.every((file) => file.checksum === null)).toBe(true);
  expect(final.quarantined).toHaveLength(3);
  expect(final.quarantined.every((file) => file.checksum === null)).toBe(true);
  expect(final.journals).toHaveLength(6);
  expect(
    final.journals
      .filter((journal) => journal.kind === "purge")
      .every((journal) => journal.phase === "complete"),
  ).toBe(true);
  expect(final.warningHistory).toEqual(quarantined.warningHistory);
  expect(final.publication).toEqual(initial.publication);
  expect(final.transitions).toEqual(initial.transitions);
  expect(final.binding).toEqual(quarantined.binding);
  expect(final.sends).toHaveLength(1);
  const oldReceipt = receipt(quarantined.operation.result);
  expect(receipt(final.operation.result)).toEqual(oldReceipt);
  expect(oldReceipt.committedAt).toBe(
    quarantined.decision?.quarantinedAt?.toISOString(),
  );
  const lifecycle = final.asset.subtitles.filter((subtitle) =>
    ["installed", "quarantined", "purged"].includes(subtitle.state),
  );
  expect(lifecycle).toHaveLength(2);
  expect(
    lifecycle.every(
      (subtitle) =>
        subtitle.state === "purged" &&
        subtitle.videoVersion === final.asset.version,
    ),
  ).toBe(true);
  expect(
    final.asset.subtitles.filter((subtitle) => subtitle.state === "validated"),
  ).toEqual(
    initial.asset.subtitles.filter(
      (subtitle) => subtitle.state === "validated",
    ),
  );
}

async function dispatchRoleOperations(
  scenario: Scenario,
  environment: TestWorkflowEnvironment,
  allowed: string[],
  starts: Map<string, string>,
) {
  const result = await scenario.dispatch(async (start) => {
    const id = start.input["operationId"];
    if (typeof id !== "string" || !allowed.includes(id))
      throw new Error(
        "Independent acquisition, captions, notices and seeding stay queued",
      );
    expect(start.workflowType).toBe(
      id === scenario.input.operationId
        ? "retainMovieEditionV4Workflow"
        : "deliverMediaNotificationWorkflow",
    );
    await environment.client.workflow.start(start.workflowType, {
      workflowId: start.workflowId,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [start.input],
    });
    starts.set(id, start.workflowId);
  });
  expect(result.dispatched).toBe(allowed.length);
}

async function waitForEvidence(
  scenario: Scenario,
  ready: (evidence: Evidence) => boolean,
) {
  const deadline = performance.now() + 20_000;
  for (;;) {
    const evidence = await scenario.evidence();
    if (ready(evidence)) return evidence;
    if (performance.now() >= deadline)
      throw new Error("Actual retention role milestone did not settle");
    await Bun.sleep(25);
  }
}

function receipt(raw: unknown) {
  return RetentionResult.parse(raw).movieQuarantinePlexReceiptV2;
}

const RetentionResult = z.object({
  movieQuarantinePlexReceiptV2: z
    .object({ committedAt: z.iso.datetime() })
    .catchall(z.json()),
});

async function replayRetentionHistory(
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
    "magnet:",
    "Workflow.Fixture",
    "Workflow Fixture",
    "/data/movies",
    "/downloads",
    "movieQuarantinePlexReceiptV2",
    "@retention.fixture",
    "synthetic-requester",
    "providerReceipt",
  ]);
  const historyPath = path.join(options.directory, `${options.name}.json`);
  await Bun.write(historyPath, history);
  const replay = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "replay",
      historyPath,
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, , error] = await Promise.all([
    replay.exited,
    new Response(replay.stdout).text(),
    new Response(replay.stderr).text(),
  ]);
  expect(code, error).toBe(0);
}
