import {
  plexRoleActivities,
  createMediaActivityTestWorker,
  createAcquisitionFileTestWorker,
} from "#activities/media/testing/activity-workers.ts";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Worker } from "@temporalio/worker";

import { expect, test } from "vitest";
import { z } from "zod";
import { createPerEpisodeRollbackRoleFixtureV1 } from "@shepherdjerred/media/testing/per-episode-rollback-workflow";
import { createAcquisitionNetworkWorkerActivities } from "#activities/media/acquisition.ts";

import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  mediaWorkflowWorkerScript,
  movieWorkflowChildEnvironment,
  createMovieRoleEnvironment,
  closeMovieRoleFixture,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { replaySeriesPackRoleHistories } from "./replay.ts";
import { seriesPackRoleFailureEvidence } from "./failure-evidence.ts";
import { assertSeriesPackRollbackActivities } from "./rollback-role-assertions.ts";
import { seriesPackRoleResult } from "./result.ts";

test("a genuine twenty-four-file outbox acquisition crosses actual Node/Network/Files roles, rejects false Plex Parts and restores both original library seasons", async () => {
  const caseDeadline = Date.now() + 60_000;
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-series-pack-rollback-role-"),
  );
  const environment = await createMovieRoleEnvironment(temporal);
  let fixture:
    | Awaited<ReturnType<typeof createPerEpisodeRollbackRoleFixtureV1>>
    | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  const started: string[] = [];
  try {
    fixture = await createPerEpisodeRollbackRoleFixtureV1();
    const scenario = fixture;
    const before = await scenario.evidence();
    expect(before.attempts).toEqual([]);
    expect(before.personalRequests).toBe(0);
    const script = mediaWorkflowWorkerScript;
    const childEnvironment = movieWorkflowChildEnvironment();
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
    });
    const network = await createMediaActivityTestWorker(environment, {
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        ...createAcquisitionNetworkWorkerActivities(() =>
          Promise.resolve({ acquisition: scenario.acquisition }),
        ),
        ...plexRoleActivities(() => Promise.resolve(scenario)),
        finishMediaOperation: scenario.finishMediaOperation,
      },
    });
    const files = await createAcquisitionFileTestWorker(
      environment,
      "dev",
      () => Promise.resolve({ acquisition: scenario.fileAcquisition }),
    );
    workers.push(network, files);
    running.push(network.run(), files.run());
    for (let page = 0; page < 8 && started.length === 0; page++)
      await scenario.dispatch(async (start) => {
        if (!scenario.roleCommand(start))
          throw new Error(
            "Unrelated initial binding and independent commands remain queued",
          );
        expect(start.workflowType).toBe("reconcileMediaWorkflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
        started.push(start.workflowId);
      });
    const workflowId = started[0];
    if (workflowId === undefined)
      throw new Error("Actual due outbox did not dispatch its selected pack");
    expect(
      await seriesPackRoleResult({ environment, workflowId, caseDeadline }),
    ).toMatchObject({ status: "blocked" });
    const after = await scenario.evidence();
    expect(after.attempts).toHaveLength(1);
    const attempt = after.attempts[0];
    if (attempt === undefined)
      throw new Error("Actual pack acquisition omitted its original attempt");
    expect(attempt).toMatchObject({
      state: "rolled_back",
      sponsorRequestId: null,
      reservations: [],
      torrent: { owned: true },
    });
    expect([...attempt.mediaIds].sort()).toEqual([...scenario.mediaIds].sort());
    expect(after.operation.status).toBe("reconciling");
    expect(after.current).toHaveLength(24);
    expect(new Set(after.current.map((row) => row.assetId))).toEqual(
      new Set(scenario.originalAssetIds),
    );
    expect(
      after.current.every(
        (row) => row.asset.version === 2 && row.asset.state === "published",
      ),
    ).toBe(true);
    expect(after.hashes).toEqual(before.hashes);
    expect(after.rejected).toHaveLength(24);
    expect(after.rejected.every((asset) => asset.version === 1)).toBe(true);
    expect(after.bindings).toHaveLength(24);
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
    expect(after.receipts).toEqual(before.receipts);
    expect(after.personalRequests).toBe(0);
    expect(after.adds).toBe(1);
    const acquisitionHistory = await environment.client.workflow
      .getHandle(`media-acquire-${attempt.id}`)
      .fetchHistory();
    assertSeriesPackRollbackActivities(acquisitionHistory);
    expect(
      await replaySeriesPackRoleHistories({
        environment,
        node,
        script,
        directory,
        childEnvironment,
        executions: [
          ...started.map((id) => ({
            workflowId: id,
            phase: "acquire" as const,
          })),
          { workflowId: `media-acquire-${attempt.id}`, phase: "acquire" },
        ],
      }),
    ).toBe(true);
  } catch (error) {
    const state = await fixture?.diagnostic();
    const evidence = await seriesPackRoleFailureEvidence({
      environment,
      workflowIds: started,
      directory,
    });
    throw new Error(
      `Actual series pack role failed: ${JSON.stringify({ state, evidence, workflowExitCode: workflow?.exitCode })}`,
      { cause: error },
    );
  } finally {
    await closeMovieRoleFixture({
      workers,
      running,
      workflow,
      fixture,
      environment,
      directory,
    });
  }
}, 60_000);
