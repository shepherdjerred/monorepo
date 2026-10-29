import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createFutureSeriesWorkflowFixture } from "@shepherdjerred/media/testing/future-series-workflow";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "./acquisition.ts";
import { createCatalogCoverageWorkerActivities } from "./catalog-coverage.ts";
import { createPlexPublicationActivities } from "./plex-publication.ts";
import { createPlexBoundConsumerActivities } from "./plex-consumers.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import { assertPrivateHistory } from "./testing/history.ts";

type Scenario = Awaited<ReturnType<typeof createFutureSeriesWorkflowFixture>>;

async function runStages(
  scenario: Scenario,
  environment: TestWorkflowEnvironment,
) {
  const ids: string[] = [];
  for (const kind of [
    "refresh_catalog",
    "expand_catalog_requests",
    "reconcile_media",
  ]) {
    const state = await scenario.evidence();
    const operation = state.operations.find((row) => row.kind === kind);
    if (operation === undefined)
      throw new Error(`Actual ${kind} outbox missing`);
    const expectedTypes: Record<string, string> = {
      refresh_catalog: "refreshMediaCatalogWorkflow",
      expand_catalog_requests: "expandCatalogRequestsWorkflow",
      reconcile_media: "reconcileMediaWorkflow",
    };
    const dispatched = await scenario.dispatch(async (start) => {
      if (start.input["operationId"] !== operation.id)
        throw new Error("Other adoption and independent commands stay queued");
      expect(start.workflowType).toBe(expectedTypes[kind]);
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
      ids.push(start.workflowId);
    });
    expect(dispatched.dispatched).toBe(1);
    await environment.client.connection.withDeadline(Date.now() + 20_000, () =>
      environment.client.workflow
        .getHandle(`media-operation-${operation.id}`)
        .result(),
    );
  }
  return ids;
}

async function replayHistory(
  environment: TestWorkflowEnvironment,
  id: string,
  options: {
    node: string;
    script: string;
    directory: string;
    childEnvironment: { PATH: string };
    privateTitle: string;
  },
) {
  const history = await environment.client.workflow
    .getHandle(id)
    .fetchHistory();
  for (const event of history.events ?? []) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled?.activityType?.name !== "expandCatalogRequests") continue;
    expect(scheduled.taskQueue?.name).toBe(TASK_QUEUES.MEDIA_NETWORK);
    expect(Number(scheduled.startToCloseTimeout?.seconds)).toBe(300);
    expect(scheduled.retryPolicy?.maximumAttempts).toBe(3);
  }
  const serialized = historyToJSON(history);
  assertPrivateHistory(serialized, [
    options.privateTitle,
    "seriesMonitoring",
    "library_series_management",
    "magnet:",
    "profileVersionAtCapture",
    "selectionHash",
    "encryptedSource",
    "/data/tv",
    "/downloads/media",
  ]);
  const target = path.join(options.directory, `${id}.json`);
  await Bun.write(target, serialized);
  const replay = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "replay",
      target,
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

test.each([undefined, "Season 02/03.mkv", "Season02/E03.mkv"])(
  "real role workers discover a later catalog episode and publish member %s with actual household approval and private replayable histories",
  async (memberPath) => {
    const { temporal, node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-future-series-role-"),
    );
    const environment = await TestWorkflowEnvironment.createLocal({
      server: {
        executable: { type: "existing-path", path: temporal },
        ip: "127.0.0.1",
        namespace: "dev",
        ui: false,
      },
    });
    let fixture: Scenario | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createFutureSeriesWorkflowFixture(
        memberPath === undefined ? {} : { memberPath },
      );
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.episode).toBeNull();
      expect(initial.attempts).toEqual([]);
      expect(initial.personalRequests).toBe(0);
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
      });
      const network = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...createAcquisitionNetworkWorkerActivities(scenario.loadAcquisition),
          ...createCatalogCoverageWorkerActivities(() =>
            Promise.resolve({ catalogCoverage: scenario.catalogCoverage }),
          ),
          ...createPlexPublicationActivities(scenario.loadPublication),
          ...createPlexBoundConsumerActivities(scenario.loadPublication),
          refreshMediaCatalog: scenario.refreshMediaCatalog,
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: createAcquisitionFileWorkerActivities(() =>
          Promise.resolve({ acquisition: scenario.fileAcquisition }),
        ),
      });
      workers.push(files);
      running.push(files.run());
      const started = await runStages(scenario, environment);
      const evidence = await scenario.evidence();
      expect(evidence.episode).toMatchObject({
        seasonNumber: 2,
        episodeNumber: 3,
        originalLanguage: "en",
      });
      expect(evidence.personalRequests).toBe(0);
      expect(evidence.attempts).toHaveLength(1);
      const attempt = evidence.attempts[0];
      if (attempt === undefined)
        throw new Error("Actual future episode acquisition missing");
      expect(attempt).toMatchObject({
        state: "completed",
        sponsorRequestId: null,
        identityEvidence: {
          schemaVersion: 4,
          management: {
            schemaVersion: 2,
            policyScope: "series",
            receiptId: scenario.receiptId,
          },
        },
        reservations: [],
        torrent: { owned: true },
      });
      expect(evidence.adds).toBe(1);
      if (memberPath !== undefined)
        expect(attempt.filePlan).toEqual([
          expect.objectContaining({
            identityEvidence: expect.objectContaining({
              schemaVersion: 2,
              kind: "tv_season_directory",
              sourceFile: expect.objectContaining({ relativePath: memberPath }),
              directory: expect.objectContaining({ season: 2, episode: 3 }),
            }),
          }),
        ]);
      expect(evidence.physical).toHaveLength(2);
      expect(
        evidence.physical.every(
          (file) => file.checksum === file.expectedChecksum,
        ),
      ).toBe(true);
      expect(evidence.assets).toHaveLength(2);
      expect(
        evidence.assets.every((asset) => asset.state === "published"),
      ).toBe(true);
      expect(
        evidence.assets.some((asset) => asset.id === scenario.originalAssetId),
      ).toBe(true);
      for (const id of [...started, `media-acquire-${attempt.id}`])
        await replayHistory(environment, id, {
          node,
          script,
          directory,
          childEnvironment,
          privateTitle: scenario.privateTitle,
        });
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
