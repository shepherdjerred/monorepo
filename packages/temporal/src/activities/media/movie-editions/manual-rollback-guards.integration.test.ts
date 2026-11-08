import { expect, test } from "vitest";
import { z } from "zod";
import { createManualMovieRollbackFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-workflow";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { manualMovieRollbackWorkers } from "./manual-rollback-sdk.test-support.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

async function scenario() {
  const f = await createManualMovieRollbackFixture(
    "extended_cut",
    rollbackInputs.videos(),
  );
  rollbackInputs.closeAfterTest(f.close);
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
  return {
    ...f,
    sdk,
    workers: manualMovieRollbackWorkers(() => Promise.resolve(f.manual)),
  };
}

test("manual Files cannot cancel original cleanup or mutate bytes without its actual Network playback observation", async () => {
  const f = await scenario();
  const before = await f.state();
  const immutable = await f.immutable();
  expect(
    await f
      .sdk("no-network-parent")
      .run(f.workers.prepareRequestedMovieRollbackV1, f.input),
  ).toEqual({
    status: "blocked",
    reason: "movie_rollback_playback_observation_required",
  });
  expect(await f.state()).toEqual(before);
  expect(await f.immutable()).toEqual(immutable);
  const receipts = await f.receipts();
  expect(receipts.movieRollbackIntentV1).toBeUndefined();
}, 60_000);

test("an actual unknown unrelated Plex session protects manual admission with no new Event or cleanup claim", async () => {
  const f = await scenario();
  const before = await f.state();
  const session = await f.context.plex.metadata(f.wire.ratingKey);
  f.wire.control.sessions.push({
    ...session,
    ratingKey: "999999999",
    Media: session.Media?.map((media) => ({
      ...media,
      Part: media.Part?.map((part) => ({
        ...part,
        file: "/data/movies/unowned/unknown-session.mkv",
      })),
    })),
  });
  expect(
    await f
      .sdk("unknown-session")
      .run(f.workers.observeRequestedMovieRollbackV1, f.input),
  ).toEqual({ status: "blocked", reason: "active_playback" });
  expect(
    await f.db.applicationEvent.count({
      where: { kind: "movie_rollback_playback_v1", mediaId: f.scope.mediaId },
    }),
  ).toBe(0);
  expect(await f.state()).toEqual(before);
  expect(f.workers.invocations.every((entry) => entry.paid <= 100)).toBe(true);
}, 60_000);

test.each(["admission", "inverse"] as const)(
  "manual %s keeps the caller's already-spent99 allowance and produces no native or SQL effects",
  async (phase) => {
    const f = await scenario();
    if (phase === "inverse") {
      expect(
        await f
          .sdk("admission-observe")
          .run(f.workers.observeRequestedMovieRollbackV1, f.input),
      ).toEqual({ status: "ready", reason: null });
      expect(
        await f
          .sdk("admit")
          .run(f.workers.prepareRequestedMovieRollbackV1, f.input),
      ).toEqual({ status: "prepared", reason: null });
      expect(
        await f
          .sdk("inverse-observe")
          .run(f.workers.observeRequestedMovieRollbackV1, f.input),
      ).toEqual({ status: "ready", reason: null });
    }
    const before = await f.state();
    const receipts = await f.receipts();
    const immutable = await f.immutable();
    const workers = manualMovieRollbackWorkers(() =>
      Promise.resolve({
        ...f.manual,
        prepareRequestedMovieRollbackV1: (
          ...args: Parameters<typeof f.manual.prepareRequestedMovieRollbackV1>
        ) => {
          args[3].consume(99);
          return f.manual.prepareRequestedMovieRollbackV1(...args);
        },
        rollbackRequestedMoviePublicationV1: (
          ...args: Parameters<
            typeof f.manual.rollbackRequestedMoviePublicationV1
          >
        ) => {
          args[3].consume(99);
          return f.manual.rollbackRequestedMoviePublicationV1(...args);
        },
      }),
    );
    const work = async () =>
      phase === "admission"
        ? await workers.prepareRequestedMovieRollbackV1(f.input)
        : await workers.rollbackRequestedMoviePublicationV1(f.input);
    await expect(f.sdk(`original99-${phase}`).run(work)).rejects.toMatchObject({
      type: "CompensationActivityFailure",
    });
    expect(workers.invocations.at(-1)?.paid).toBe(101);
    expect(await f.state()).toEqual(before);
    expect(await f.receipts()).toEqual(receipts);
    expect(await f.immutable()).toEqual(immutable);
  },
  60_000,
);

test.each(["known_without_receipt", "unknown"] as const)(
  "an actual pending %s participant remains protected despite other committed caption wrappers",
  async (participant) => {
    const f = await scenario();
    expect(
      await f
        .sdk("playback")
        .run(f.workers.observeRequestedMovieRollbackV1, f.input),
    ).toEqual({ status: "ready", reason: null });
    const targetId = f.plan.entries[0].assetId;
    const source = await f.db.operation.findFirstOrThrow({
      where: { kind: "acquire_movie_subtitles_v4", targetId },
    });
    const operationId = crypto.randomUUID();
    const kind =
      participant === "unknown" ? "unknown_movie_asset_work" : source.kind;
    const payload = {
      ...z.record(z.string(), z.json()).parse(source.payload),
      operationId,
      kind,
    };
    await f.db.operation.create({
      data: {
        id: operationId,
        idempotencyKey: `manual-pending-control:${operationId}`,
        targetId,
        kind,
        userId: source.userId,
        payload,
        outbox: { create: { kind, payload } },
      },
    });
    const before = await f.state();
    const immutable = await f.immutable();
    expect(
      await f
        .sdk("pending-admission")
        .run(f.workers.prepareRequestedMovieRollbackV1, f.input),
    ).toEqual({
      status: "blocked",
      reason: "movie_rollback_dependencies_active",
    });
    expect(await f.state()).toEqual(before);
    expect(await f.immutable()).toEqual(immutable);
    const receipts = await f.receipts();
    expect(receipts.movieRollbackIntentV1).toBeUndefined();
    expect(f.workers.invocations.every((entry) => entry.paid <= 100)).toBe(
      true,
    );
  },
  60_000,
);
