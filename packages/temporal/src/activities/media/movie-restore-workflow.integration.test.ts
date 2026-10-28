import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { z } from "zod";
import { expect, test } from "vitest";
import { createMovieRestoreWorkflowFixture } from "@shepherdjerred/media/testing/movie-restore-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./movie-editions.ts";
import { createMovieWatchWorkerActivitiesV4 } from "./movie-watch.ts";
import { createPlexBoundConsumerActivities } from "./plex-consumers.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import {
  assertPrivateHistory,
  assertScopedMovieRestoreActivityBudgets,
} from "./testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Scenario = Awaited<ReturnType<typeof createMovieRestoreWorkflowFixture>>;
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
  "genuine %s post-quarantine request restores and rebinds through actual roles, sends availability and records current watch, then replays",
  async (edition) => {
    const { node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-movie-restore-role-"),
    );
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let fixture: Scenario | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createMovieRestoreWorkflowFixture(edition);
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.asset.state).toBe("quarantined");
      expect(initial.operation.kind).toBe("restore_movie_edition_v4");
      expect(initial.library).toHaveLength(3);
      expect(initial.library.every((file) => file.checksum === null)).toBe(
        true,
      );
      expect(initial.quarantined.every((file) => file.checksum !== null)).toBe(
        true,
      );
      expect(initial.journals).toEqual([]);
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
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...createMovieNetworkWorkerActivitiesV4(() =>
            Promise.resolve(scenario),
          ),
          ...createPlexBoundConsumerActivities(() => Promise.resolve(scenario)),
          ...createMovieWatchWorkerActivitiesV4(() =>
            Promise.resolve(scenario),
          ),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: createMovieFileWorkerActivitiesV4(() =>
          Promise.resolve({ movie: scenario.fileMovie }),
        ),
      });
      workers.push(files);
      running.push(files.run());
      const starts = new Map<string, string>();
      await dispatchRestoreRole(
        scenario,
        environment,
        [
          {
            id: scenario.input.operationId,
            type: "restoreMovieEditionV4Workflow",
          },
        ],
        starts,
      );
      await completed(environment, starts.get(scenario.input.operationId));
      const restored = await scenario.evidence();
      assertActualRestoration(initial, restored, scenario);
      expect(restored.notices).toHaveLength(1);
      expect(restored.notices[0]?.event.payload).toMatchObject({
        schemaVersion: 4,
        kind: "movie_restoration",
        eventKind: "media_available",
        source: scenario.input,
        asset: { id: restored.asset.id, version: restored.asset.version },
      });
      const notices = await scenario.restorationNoticeOperationIds();
      expect(notices).toHaveLength(1);
      await dispatchRestoreRole(
        scenario,
        environment,
        notices.map((id) => ({ id, type: "deliverMediaNotificationWorkflow" })),
        starts,
      );
      for (const id of notices) await completed(environment, starts.get(id));
      const watch = await scenario.watchOperation();
      await dispatchRestoreRole(
        scenario,
        environment,
        [{ id: watch.operationId, type: "observeMoviePlexHintV4Workflow" }],
        starts,
      );
      const watchResult = await result(
        environment,
        starts.get(watch.operationId),
      );
      expect(watchResult).toEqual({ status: "observed", complete: true });
      const final = await scenario.evidence();
      expect(final.notices[0]).toMatchObject({ state: "accepted" });
      expect(final.sends).toHaveLength(initial.sends.length + 1);
      expect(final.sends.at(-1)?.subject).toContain("Workflow Fixture");
      expect(final.publication).toEqual(initial.publication);
      expect(final.quarantine).toEqual(initial.quarantine);
      expect(final.attempts).toEqual(initial.attempts);
      expect(final.torrents).toEqual(initial.torrents);
      expect(final.seeding).toEqual(initial.seeding);
      expect(final.transitions).toEqual(initial.transitions);
      expect(final.subtitleCommands).toEqual(initial.subtitleCommands);
      expect(final.history).toEqual(initial.history);
      const ready = await scenario.readiness();
      expect(ready.fulfillment).toEqual({ status: "fulfilled", reason: null });
      expect(ready.protectedReasons).toEqual([]);
      expect(ready.targets).toHaveLength(2);
      expect(ready.targets.every((target) => target.complete)).toBe(true);
      expect(ready.watch).toMatchObject({
        status: "known",
        projection: {
          watched: true,
          scope: { mediaId: scenario.scope.mediaId, edition },
        },
      });
      for (const [operationId, workflowId] of starts) {
        const history = await environment.client.workflow
          .getHandle(workflowId)
          .fetchHistory();
        const phase =
          operationId === scenario.input.operationId
            ? "restore"
            : operationId === watch.operationId
              ? "watch"
              : "notice";
        assertScopedMovieRestoreActivityBudgets(history, phase);
        await replayRestoreHistory(historyToJSON(history), {
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

const PhysicalReceipt = z.object({
  receipt: z
    .object({ committedAt: z.iso.datetime(), journals: z.array(z.json()) })
    .catchall(z.json()),
  receiptHash: z.string(),
});
const PlexReceipt = z.object({
  receipt: z
    .object({
      committedAt: z.iso.datetime(),
      reboundAt: z.iso.datetime(),
      assetPlexPublishedAt: z.iso.datetime().nullable(),
      observation: z
        .object({
          associations: z.tuple([
            z
              .object({
                item: z
                  .object({
                    ratingKey: z.string(),
                    media: z.tuple([
                      z
                        .object({
                          parts: z.tuple([
                            z
                              .object({ id: z.string(), file: z.string() })
                              .catchall(z.json()),
                          ]),
                        })
                        .catchall(z.json()),
                    ]),
                  })
                  .catchall(z.json()),
              })
              .catchall(z.json()),
          ]),
          verification: z
            .object({ passes: z.array(z.json()) })
            .catchall(z.json()),
        })
        .catchall(z.json()),
    })
    .catchall(z.json()),
  receiptHash: z.string(),
});

function assertActualRestoration(
  initial: Evidence,
  restored: Evidence,
  scenario: Scenario,
) {
  expect(restored.operation.status).toBe("completed");
  expect(restored.decision.state).toBe("restored");
  expect(restored.asset).toMatchObject({
    state: "published",
    edition: initial.asset.edition,
    version: initial.asset.version + 1,
  });
  expect(restored.asset.plexPublishedAt).toEqual(initial.asset.plexPublishedAt);
  expect(restored.target.availability).toBe("available");
  expect(
    restored.library
      .map((file) => file.checksum)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(
    initial.quarantined
      .map((file) => file.checksum)
      .sort((a, b) => String(a).localeCompare(String(b))),
  );
  expect(restored.quarantined.every((file) => file.checksum === null)).toBe(
    true,
  );
  expect(restored.journals).toHaveLength(3);
  expect(
    restored.journals.every(
      (journal) => journal.kind === "restore" && journal.phase === "complete",
    ),
  ).toBe(true);
  const raw = z
    .object({
      movieRestoreReceiptV1: PhysicalReceipt,
      movieRestorePlexReceiptV1: PlexReceipt,
    })
    .parse(restored.operation.result);
  expect(raw.movieRestoreReceiptV1.receipt.journals).toHaveLength(3);
  expect(
    Date.parse(raw.movieRestoreReceiptV1.receipt.committedAt),
  ).toBeLessThanOrEqual(Date.now());
  expect(
    Date.parse(raw.movieRestorePlexReceiptV1.receipt.committedAt),
  ).toBeLessThanOrEqual(Date.now());
  expect(raw.movieRestorePlexReceiptV1.receipt.assetPlexPublishedAt).toBe(
    initial.asset.plexPublishedAt?.toISOString(),
  );
  expect(
    raw.movieRestorePlexReceiptV1.receipt.observation.verification.passes,
  ).toHaveLength(2);
  const original = z
    .object({
      item: z
        .object({
          ratingKey: z.string(),
          media: z.tuple([
            z
              .object({
                parts: z.tuple([
                  z
                    .object({ id: z.string(), file: z.string() })
                    .catchall(z.json()),
                ]),
              })
              .catchall(z.json()),
          ]),
        })
        .catchall(z.json()),
    })
    .parse(scenario.originalAssociation.evidence);
  const actual =
    raw.movieRestorePlexReceiptV1.receipt.observation.associations[0].item;
  expect(actual.ratingKey).toBe(original.item.ratingKey);
  expect(actual.media[0].parts[0]).toEqual(original.item.media[0].parts[0]);
  expect(restored.binding.revision).toBe(scenario.originalBinding.revision + 2);
  expect(restored.originalAssociation).toEqual(scenario.originalAssociation);
  expect(restored.publication).toEqual(initial.publication);
  expect(restored.quarantine).toEqual(initial.quarantine);
  expect(restored.attempts).toEqual(initial.attempts);
  expect(restored.torrents).toEqual(initial.torrents);
  expect(restored.seeding).toEqual(initial.seeding);
  expect(restored.transitions).toEqual(initial.transitions);
}

async function dispatchRestoreRole(
  scenario: Scenario,
  environment: TestWorkflowEnvironment,
  allowed: { id: string; type: string }[],
  starts: Map<string, string>,
) {
  const dispatch = await scenario.dispatch(async (start) => {
    const id = start.input["operationId"];
    const expected = allowed.find((item) => item.id === id);
    if (typeof id !== "string" || expected === undefined)
      throw new Error(
        "Independent acquisition, warning, retention, captions and seeding remain queued",
      );
    expect(start.workflowType).toBe(expected.type);
    await environment.client.workflow.start(start.workflowType, {
      workflowId: start.workflowId,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [start.input],
    });
    starts.set(id, start.workflowId);
  });
  expect(dispatch.dispatched).toBe(allowed.length);
}

async function result(
  environment: TestWorkflowEnvironment,
  workflowId: string | undefined,
): Promise<unknown> {
  if (workflowId === undefined)
    throw new Error("Actual restore role outbox omitted Workflow");
  const handle = environment.client.workflow.getHandle(workflowId);
  return environment.client.connection.withDeadline(Date.now() + 20_000, () =>
    handle.result(),
  );
}

async function completed(
  environment: TestWorkflowEnvironment,
  workflowId: string | undefined,
) {
  expect(await result(environment, workflowId)).toEqual({
    status: "completed",
  });
}

async function replayRestoreHistory(
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
    "movieRestoreReceiptV1",
    "movieRestorePlexReceiptV1",
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
