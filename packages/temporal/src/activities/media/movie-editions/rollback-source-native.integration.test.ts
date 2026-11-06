import { afterEach, beforeAll, expect, test } from "vitest";
import { createManualMovieRollbackFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-workflow";
import { movieRollbackSourceHarness } from "@shepherdjerred/media/testing/movie-rollback-source";
import { movieRollbackVideos } from "@shepherdjerred/media/testing/movie-rollback-workflow";
import { createSeedingWorkerActivities } from "#activities/media/seeding.ts";
import { createMovieNetworkWorkerActivitiesV4 } from "#activities/media/movie-editions.ts";
import { rollbackGuardScenario } from "./rollback-guards.test-support.ts";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { manualMovieRollbackWorkers } from "./manual-rollback-sdk.test-support.ts";

const closers: (() => Promise<void>)[] = [];
let videos: Awaited<ReturnType<typeof movieRollbackVideos>>;
beforeAll(async () => {
  videos = await movieRollbackVideos();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("actual automatic rejected B source drains only after original A rebind while imported B birth stays literal", async () => {
  const f = await rollbackGuardScenario(videos);
  closers.push(f.close);
  await f.reject();
  await f.admit();
  const source = await movieRollbackSourceHarness({
    context: f.context,
    source: f.input,
    wire: f.wire,
  });
  source.setEligible();
  const seed = createSeedingWorkerActivities(() =>
    Promise.resolve({ seeding: source.seeding }),
  );
  const immutable = await f.immutable();
  expect(
    await f
      .sdk("physical-before-source-check")
      .run(f.files.rollbackMoviePublicationV4, f.input),
  ).toEqual({ status: "physically_rolled_back", reason: null });
  expect(
    await f
      .sdk("source-before-rebind")
      .run(seed.removeMediaTorrent, source.input),
  ).toEqual({ status: "protected", reason: "source_in_use" });
  expect(f.wire.control.deletes).toBe(0);
  expect(
    await f
      .sdk("source-a-rebind")
      .run(f.network.verifyRolledBackMoviePlexV4, f.input),
  ).toEqual({ status: "available", reason: null });
  const before = await f.state();
  expect(
    await f
      .sdk("source-after-rebind")
      .run(seed.removeMediaTorrent, source.input),
  ).toEqual({ status: "removed", reason: null });
  expect(f.wire.control.deletes).toBe(1);
  const after = await f.state();
  expect(after.predecessor).toEqual(before.predecessor);
  expect(after.successor).toEqual(before.successor);
  expect(after.bytes).toEqual(before.bytes);
  expect(await f.immutable()).toEqual(immutable);
  expect(
    await f
      .sdk("source-removed-physical-ack")
      .run(f.files.rollbackMoviePublicationV4, f.input),
  ).toEqual({ status: "physically_rolled_back", reason: null });
  expect(
    await f
      .sdk("source-removed-plex-ack")
      .run(f.network.verifyRolledBackMoviePlexV4, f.input),
  ).toEqual({ status: "available", reason: null });
  expect(f.wire.control.deletes).toBe(1);
}, 60_000);

test("actual manual rollback source drains after real closure before its queued wrapper ACK without deleting either caption lineage", async () => {
  const f = await createManualMovieRollbackFixture("extended_cut", videos);
  closers.push(f.close);
  const workers = manualMovieRollbackWorkers(() => Promise.resolve(f.manual));
  const originalNetwork = createMovieNetworkWorkerActivitiesV4(() =>
    Promise.resolve({ movie: f.movie }),
  );
  const runId = crypto.randomUUID();
  const sdk = (activityId: string) =>
    movieRollbackSdkEnvironment({
      workflowExecution: {
        workflowId: `media-operation-${f.input.operationId}`,
        runId,
      },
      activityId,
      scheduledTimestampMs: Date.now(),
      currentAttemptScheduledTimestampMs: Date.now(),
      startToCloseTimeoutMs: 120_000,
      scheduleToCloseTimeoutMs: 180_000,
      heartbeatTimeoutMs: 30_000,
    });
  expect(
    await sdk("admission-session").run(
      workers.observeRequestedMovieRollbackV1,
      f.input,
    ),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await sdk("manual-admission").run(
      workers.prepareRequestedMovieRollbackV1,
      f.input,
    ),
  ).toEqual({ status: "prepared", reason: null });
  expect(
    await sdk("inverse-session").run(
      workers.observeRequestedMovieRollbackV1,
      f.input,
    ),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await sdk("manual-inverse").run(
      workers.rollbackRequestedMoviePublicationV1,
      f.input,
    ),
  ).toEqual({ status: "physically_rolled_back", reason: null });
  const source = await movieRollbackSourceHarness({
    context: f.context,
    source: f.sourceInput,
    wire: f.wire,
  });
  source.setEligible();
  const seed = createSeedingWorkerActivities(() =>
    Promise.resolve({ seeding: source.seeding }),
  );
  expect(
    await sdk("manual-source-before-plex").run(
      seed.removeMediaTorrent,
      source.input,
    ),
  ).toEqual({ status: "protected", reason: "source_in_use" });
  expect(f.wire.control.deletes).toBe(0);
  expect(
    await sdk("manual-a-rebind").run(
      workers.verifyRequestedMovieRollbackV1,
      f.input,
    ),
  ).toEqual({ status: "available", reason: null });
  const before = await f.state();
  const immutable = await f.immutable();
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  expect(operation.status).toBe("queued");
  expect(
    await sdk("manual-source-complete").run(
      seed.removeMediaTorrent,
      source.input,
    ),
  ).toEqual({ status: "removed", reason: null });
  expect(f.wire.control.deletes).toBe(1);
  expect(await f.state()).toEqual(before);
  expect(await f.immutable()).toEqual(immutable);
  expect(
    await sdk("manual-source-removed-old-b-serving-ack").run(
      originalNetwork.publishMovieToPlexV4,
      f.sourceInput,
    ),
  ).toEqual({ status: "available", reason: null });
  expect(
    await sdk("manual-source-removed-new-a-serving-ack").run(
      workers.verifyRequestedMovieRollbackV1,
      f.input,
    ),
  ).toEqual({ status: "available", reason: null });
  expect(f.wire.control.deletes).toBe(1);
}, 60_000);
