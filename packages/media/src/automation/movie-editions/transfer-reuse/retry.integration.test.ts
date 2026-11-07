import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { movieTransferReuseFixture } from "./fixture.test-support.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { createSeedingActivities } from "#automation/seeding.ts";

let bytes: Uint8Array;
const close: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const done of close.splice(0)) await done();
});
type Fixture = Awaited<ReturnType<typeof movieTransferReuseFixture>>;

async function queueRetry(f: Fixture) {
  const media = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.input.scope.mediaId },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: media.id, edition: f.input.scope.edition },
    },
  });
  const queued = await f.next.commands.retryMovieEditionV4(
    f.source.user,
    crypto.randomUUID(),
    {
      schemaVersion: 4,
      scope: f.input.scope,
      expected: { mediaVersion: media.version, targetVersion: target.version },
      command: { action: "retry" },
    },
  );
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(queued.result.operationId) },
  });
  return MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
}

async function admitted() {
  const f = await movieTransferReuseFixture("extended_cut", bytes);
  close.push(f.close);
  expect(
    await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "ready", reason: null });
  return f;
}

test.each(["downloading", "prepared", "imported"])(
  "a granted consumer's genuine %s retry retains its actual birth grant and original source tags",
  async (phase) => {
    const f = await admitted();
    if (phase !== "downloading")
      expect(
        await f.fileMovie.inspectAndStageMovieV4(
          f.input,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "staged" });
    if (phase === "imported")
      expect(
        await f.fileMovie.promoteMovieFilesV4(
          f.input,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "published" });
    const birth = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "reconciling",
      reason: "movie_operation_failed",
    });
    const queued = await queueRetry(f);
    f.context.describeWorkflow = (id) => {
      if (
        id !== `media-operation-${f.input.operationId}` &&
        id !== `media-acquire-${f.input.attemptId}`
      )
        throw new Error("Granted retry inspected an unrelated coordinator");
      return Promise.resolve({
        status: "FAILED",
        runId: `synthetic-consumer-closed:${id}`,
      });
    };
    expect(
      await f.movie.reconcileMovieIntentV4(queued, testPlexBindingExecution()),
    ).toMatchObject({ status: "acquire", attemptId: f.input.attemptId });
    const resumed = { ...f.input, operationId: queued.operationId };
    expect(
      await f.movie.submitMovieTorrentV4(resumed, testPlexBindingExecution()),
    ).toMatchObject({ status: "submitted" });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        resumed,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "ready" });
    if (phase === "downloading")
      expect(
        await f.fileMovie.inspectAndStageMovieV4(
          resumed,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "staged" });
    if (phase !== "imported")
      expect(
        await f.fileMovie.promoteMovieFilesV4(
          resumed,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "published" });
    expect(
      await f.movie.publishMovieToPlexV4(resumed, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(
      resumed,
      testPlexBindingExecution(),
    );
    const original = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    expect(
      z.object({ movieTransferReuseGrantV1: z.json() }).parse(original.result)
        .movieTransferReuseGrantV1,
    ).toEqual(
      z.object({ movieTransferReuseGrantV1: z.json() }).parse(birth.result)
        .movieTransferReuseGrantV1,
    );
    const retry = await f.db.operation.findUniqueOrThrow({
      where: { id: queued.operationId },
    });
    expect(
      z
        .object({ movieTransferReuseGrantV1: z.unknown().optional() })
        .parse(retry.result).movieTransferReuseGrantV1,
    ).toBeUndefined();
    expect(f.source.wire.additions()).toBe(1);
  },
);

test("a completed granted consumer acknowledges its committed Plex history after actual source removal without live qBit access", async () => {
  const f = await admitted();
  expect(
    await f.fileMovie.inspectAndStageMovieV4(
      f.input,
      testPublicationExecution(),
    ),
  ).toEqual({ status: "staged" });
  expect(
    await f.fileMovie.promoteMovieFilesV4(f.input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  expect(
    await f.movie.publishMovieToPlexV4(f.input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await f.movie.finalizeMovieAcquisitionV4(f.input, testPlexBindingExecution());
  const torrentId = z.uuid().parse(f.origin.torrentId);
  f.source.wire.control.ratio = 1;
  const seed = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  expect(
    await createSeedingActivities(f.context).removeMediaTorrent({
      operationId: seed.id,
      torrentId,
    }),
  ).toEqual({ status: "removed", reason: null });
  const queued = await queueRetry(f);
  vi.spyOn(f.context.qbittorrent, "observe").mockImplementation(() =>
    Promise.reject(
      new Error("Historical acknowledgement must not recreate a live transfer"),
    ),
  );
  expect(
    await f.movie.reconcileMovieIntentV4(queued, testPlexBindingExecution()),
  ).toEqual({
    status: "available",
    attemptId: null,
    reason: "historical_plex_completion",
  });
  expect(f.source.wire.additions()).toBe(1);
  expect(f.source.wire.control.deletes).toBe(1);
});
