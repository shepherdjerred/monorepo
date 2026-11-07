import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { z } from "zod";
import { createMultiSeasonRoleFixtureV1 } from "@shepherdjerred/media/testing/multi-season-workflow";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "#activities/media/acquisition.ts";
import { createSeriesPackFeedWorkerActivities } from "#activities/media/series-pack-feed.ts";
import { createPlexPublicationActivities } from "#activities/media/plex-publication.ts";
import { createPlexBoundConsumerActivities } from "#activities/media/plex-consumers.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { replaySeriesPackRoleHistories } from "./replay.ts";

test("actual multi-season feed outbox reaches separate Node, Network and Files workers, prepares publication and serves both Plex seasons without personal consent fabrication", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-series-pack-role-"),
  );
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture:
    Awaited<ReturnType<typeof createMultiSeasonRoleFixtureV1>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  try {
    fixture = await createMultiSeasonRoleFixtureV1();
    const scenario = fixture;
    const before = await scenario.evidence();
    expect(before.attempts).toEqual([]);
    expect(before.personalRequests).toBe(0);
    const script = new URL(
      "../../../../scripts/media-system/workflow-worker.ts",
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
    });
    const network = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        ...createAcquisitionNetworkWorkerActivities(() =>
          Promise.resolve({ acquisition: scenario.acquisition }),
        ),
        ...createSeriesPackFeedWorkerActivities(() =>
          Promise.resolve({ seriesPackFeed: scenario.seriesPackFeed }),
        ),
        ...createPlexPublicationActivities(() => Promise.resolve(scenario)),
        ...createPlexBoundConsumerActivities(() => Promise.resolve(scenario)),
        finishMediaOperation: scenario.finishMediaOperation,
      },
    });
    const files = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: createAcquisitionFileWorkerActivities(() =>
        Promise.resolve({ acquisition: scenario.fileAcquisition }),
      ),
    });
    workers.push(network, files);
    running.push(network.run(), files.run());
    const started: { workflowId: string; phase: "feed" | "acquire" }[] = [];
    const dispatch = () =>
      scenario.dispatch(async (start) => {
        const phase = await scenario.roleCommand(start);
        if (phase === null)
          throw new Error(
            "Unrelated adoption and independent commands stay queued",
          );
        expect(start.workflowType).toBe(
          phase === "feed"
            ? "matchSeriesPackFeedSourceWorkflow"
            : "reconcileMediaWorkflow",
        );
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
        started.push({ workflowId: start.workflowId, phase });
      });
    for (
      let page = 0;
      page < 8 && !started.some((start) => start.phase === "feed");
      page++
    )
      await dispatch();
    const feed = started.find((start) => start.phase === "feed");
    if (feed === undefined)
      throw new Error("Actual pack feed outbox was not dispatched");
    await environment.client.connection.withDeadline(Date.now() + 20_000, () =>
      environment.client.workflow.getHandle(feed.workflowId).result(),
    );
    for (
      let page = 0;
      page < 8 && !started.some((start) => start.phase === "acquire");
      page++
    )
      await dispatch();
    const acquisition = started.find((start) => start.phase === "acquire");
    if (acquisition === undefined)
      throw new Error("Actual feed did not queue its selected acquisition");
    expect(
      await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () =>
          environment.client.workflow
            .getHandle(acquisition.workflowId)
            .result(),
      ),
    ).toEqual({ status: "completed" });
    const after = await scenario.evidence();
    expect(after.attempts).toHaveLength(1);
    const attempt = after.attempts[0];
    if (attempt === undefined)
      throw new Error("Actual new pack attempt missing");
    expect(attempt).toMatchObject({
      state: "completed",
      sponsorRequestId: null,
      reservations: [],
      torrent: { owned: true },
      identityEvidence: {
        schemaVersion: 4,
        source: { seriesPackV1: { schemaVersion: 1 } },
        management: { schemaVersion: 3, policyScope: "episodes" },
      },
    });
    expect([...attempt.mediaIds].sort()).toEqual([...scenario.mediaIds].sort());
    expect(after.bindings).toHaveLength(4);
    expect(
      new Set(
        after.bindings.map(
          (binding) =>
            z
              .object({
                hierarchy: z.object({
                  season: z.object({ ratingKey: z.string() }),
                }),
              })
              .parse(binding.evidence?.evidence).hierarchy.season.ratingKey,
        ),
      ).size,
    ).toBe(2);
    for (const binding of after.bindings) {
      const prior = before.bindings.find(
        (row) => row.mediaId === binding.mediaId,
      );
      if (prior === undefined)
        throw new Error("Actual initial Plex binding missing");
      expect(binding.revision).toBe(prior.revision + 1);
    }
    expect(after.sourceHash).toBe(before.sourceHash);
    expect(after.source).toEqual(before.source);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.personalRequests).toBe(0);
    expect(after.adds).toBe(1);
    const prepared = await replaySeriesPackRoleHistories({
      environment,
      node,
      script,
      directory,
      childEnvironment,
      executions: [
        ...started,
        { workflowId: `media-acquire-${attempt.id}`, phase: "acquire" },
      ],
    });
    expect(prepared).toBe(true);
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
}, 60_000);
