import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  movieTransferReuseFixture,
  movieTransferSeedInput as actualSeedInput,
} from "./fixture.test-support.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
import { readMovieTransferReuseMarkerV1 } from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { inspectAndStageMovieV4 } from "#automation/files/movie-editions/inspection.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { reserveMovieTransferObservationWriteV1 } from "#infrastructure/movie-editions/transfer-reuse/observation-write.ts";
let bytes: Uint8Array;
const close: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const done of close.splice(0)) await done();
});
async function fixture() {
  const f = await movieTransferReuseFixture("extended_cut", bytes);
  close.push(f.close);
  return f;
}

test.each(["descriptions", "live_read", "final_configuration"])(
  "the same original SDK capability expires during %s before any grant attachment",
  async (phase) => {
    const f = await fixture();
    const original = testPlexBindingExecution();
    let expired = false;
    const execution = {
      ...original,
      assertActive: () => {
        original.assertActive();
        if (expired) throw new Error("Original reuse SDK deadline expired");
      },
    };
    if (phase === "descriptions") {
      const describe = f.context.describeWorkflow;
      f.context.describeWorkflow = async (id) => {
        const result = await describe(id);
        expired = true;
        return result;
      };
    }
    if (phase === "live_read") {
      let reads = 0;
      f.source.wire.control.beforeInfo = () => {
        if (++reads === 2) expired = true;
        return Promise.resolve();
      };
    }
    if (phase === "final_configuration") {
      let reads = 0;
      const sections = f.context.permittedSections;
      f.context.permittedSections = async () => {
        const value = await sections();
        if (++reads === 3) expired = true;
        return value;
      };
    }
    await expect(
      submitMovieTorrentV4(
        { ...f.context, plexBindingExecution: () => execution },
        f.input,
      ),
    ).rejects.toThrow("Original reuse SDK deadline expired");
    expect(
      await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      }),
    ).toMatchObject({ state: "reserved", torrentId: null });
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    expect(readMovieTransferReuseMarkerV1(operation.result)).toBeNull();
    expect(f.source.wire.additions()).toBe(1);
  },
);

test("a cancelled consumer's actual prepared plan still retains the original source bytes", async () => {
  const f = await fixture();
  await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution());
  await f.movie.observeMovieAcquisitionV4(f.input, testPlexBindingExecution());
  await f.fileMovie.inspectAndStageMovieV4(f.input, testPublicationExecution());
  const consumer = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: z.uuid().parse(consumer.sponsorRequestId) },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.scope.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  await f.next.commands.cancelMovieEditionRequest(
    f.source.user,
    crypto.randomUUID(),
    {
      schemaVersion: 3,
      action: "cancel_request",
      scope: f.input.scope,
      subjectUserId: f.source.user.id,
      requestId: request.id,
      expected: {
        targetVersion: target.version,
        requestVersion: request.version,
        choiceRevision: request.movieEditionChoiceRevision,
      },
    },
  );
  expect(
    await createSeedingActivities(f.context).removeMediaTorrent(
      await actualSeedInput(f),
    ),
  ).toMatchObject({ status: "protected", reason: "source_in_use" });
  expect(f.source.wire.control.deletes).toBe(0);
});

test.each([0, 99])(
  "raw granted staging preserves the same original allowance after %i earlier rows, with an exact overflow stack",
  async (spent) => {
    const f = await fixture();
    expect(
      await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ status: "submitted" });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        f.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "ready" });
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(spent);
    const consume = budget.consume.bind(budget);
    const trace: { count: number; stack: string | undefined }[] = [];
    vi.spyOn(budget, "consume").mockImplementation((count) => {
      trace.push({
        count,
        stack: new Error("Actual staging provenance charge").stack,
      });
      consume(count);
    });
    const execution = testPublicationExecution();
    const staged = inspectAndStageMovieV4(
      {
        ...f.source.files.context,
        publicationExecution: () => execution,
        movieManagement: { execution, budget },
      },
      f.input,
    );
    if (spent === 99) {
      await expect(staged).rejects.toThrow("100 total queried records");
      return;
    }
    await expect(staged).resolves.toBeUndefined();
    expect(
      trace.some(
        (entry) =>
          entry.stack?.includes("readMovieTransferReuseGrantV1") ?? false,
      ),
    ).toBe(true);
    expect(
      trace.reduce((sum, entry) => sum + entry.count, spent),
      JSON.stringify(trace),
    ).toBeLessThanOrEqual(100);
  },
);

test.each(["unknown", "foreign_caption"])(
  "%s pending work cannot borrow the published-library caption exception",
  async (kind) => {
    const f = await fixture();
    expect(
      await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ status: "submitted" });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        f.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "ready" });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        f.input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(
        f.input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "published" });
    expect(
      await f.movie.publishMovieToPlexV4(f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    );
    const asset = await f.db.libraryAsset.findFirstOrThrow({
      where: { torrentId: f.origin.torrentId },
    });
    const operationId = crypto.randomUUID();
    await f.db.operation.create({
      data: {
        id: operationId,
        kind:
          kind === "unknown"
            ? "synthetic_unknown_source_work"
            : "acquire_movie_subtitles_v4",
        targetId: asset.id,
        status: "queued",
        payload: {
          schemaVersion: 4,
          operationId,
          kind: "acquire_movie_subtitles_v4",
          scope: { ...f.input.scope, mediaId: crypto.randomUUID() },
          assetId: asset.id,
          recoveryEpoch: 0,
          targetAuthority: "a".repeat(64),
          language: "en",
        },
      },
    });
    f.source.wire.control.ratio = 1;
    expect(
      await createSeedingActivities(f.context).removeMediaTorrent(
        await actualSeedInput(f),
      ),
    ).toMatchObject({ status: "protected", reason: "source_in_use" });
    expect(f.source.wire.control.deletes).toBe(0);
  },
);

test("an observation reserves every actual SQL grant parent before writing with the same 99-spent allowance", async () => {
  const f = await fixture();
  expect(
    await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution()),
  ).toMatchObject({ status: "submitted" });
  const before = await f.db.torrent.findUniqueOrThrow({
    where: { id: z.uuid().parse(f.origin.torrentId) },
  });
  const observed = await f.context.qbittorrent.observe(before.infoHash);
  if (observed === null) throw new Error("Actual owned transfer disappeared");
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  let writes = 0;
  await expect(
    f.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${before.id} FOR UPDATE`;
      await reserveMovieTransferObservationWriteV1(
        tx,
        { torrentId: before.id, observation: observed },
        budget,
      );
      writes++;
      await tx.torrent.update({
        where: { id: before.id },
        data: {
          observation: { torrent: observed, files: [] },
          observedAt: new Date(),
        },
      });
    }),
  ).rejects.toThrow("100 total queried records");
  expect(writes).toBe(0);
  expect(
    await f.db.torrent.findUniqueOrThrow({ where: { id: before.id } }),
  ).toEqual(before);
});
