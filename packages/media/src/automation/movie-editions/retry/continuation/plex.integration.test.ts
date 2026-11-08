import { expect, test } from "vitest";
import { z } from "zod";
import {
  MovieRetryPlexCaptureV1Schema,
  MovieRetryPlexAcknowledgementV1Schema,
} from "#shared/movie-editions/retry/v2.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { continuationHarness, attemptInput } from "./support.ts";

const h = continuationHarness();
test.each(["default", "extended_cut"] as const)(
  "%s committed Plex recovery finalizes its actual old input and acknowledges without changing its original coordinator",
  async (edition) => {
    const f = await h.fixture(edition, "plex");
    const before = await f.evidence();
    if (before.attempt === null || before.plan === null)
      throw new Error("Actual Plex-committed acquisition missing");
    const assetId = before.plan.entries[0].assetId;
    const torrentId = z.uuid().parse(before.attempt.torrentId);
    const originalInput = await attemptInput(f, f.input.operationId);
    const original = await readMoviePlexReceiptV2(
      f.db,
      originalInput,
      new PublicationAuthorityReadBudget(),
    );
    if (original === null)
      throw new Error("Actual original Plex receipt missing");
    const journals = await f.journalEvidence();
    const files = await f.fileEvidence();
    const queued = await f.retry();
    const capture = z
      .object({ movieRetryPlexAckV1: MovieRetryPlexCaptureV1Schema })
      .parse(queued.operation.payload).movieRetryPlexAckV1;
    expect(capture.originalInput).toEqual(originalInput);
    expect(capture.originalReceiptHash).toBe(identityHash(original));
    expect(
      await f.movie.reconcileMovieIntentV4(
        queued.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "available", attemptId: null });
    const completed = await f.evidence();
    expect(completed.attempt).toMatchObject({
      state: "completed",
      coordinatorOperationId: f.input.operationId,
      filePlan: before.attempt.filePlan,
    });
    expect(completed.publication).toEqual(before.publication);
    expect(completed.adds).toBe(1);
    expect(
      await readMoviePlexReceiptV2(
        f.db,
        originalInput,
        new PublicationAuthorityReadBudget(),
      ),
    ).toEqual(original);
    const stored = await f.db.operation.findUniqueOrThrow({
      where: { id: queued.input.operationId },
    });
    const acknowledgement = MovieRetryPlexAcknowledgementV1Schema.parse(
      z
        .object({ movieRetryPlexAcknowledgementV1: z.json() })
        .parse(stored.result).movieRetryPlexAcknowledgementV1,
    );
    expect(acknowledgement).toMatchObject({
      originalInput,
      originalReceiptHash: identityHash(original),
      kind: "finalization",
      completed: true,
    });
    const captions = await f.db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: assetId },
    });
    expect(captions).toHaveLength(2);
    const ackOnly = createMovieNetworkFacetV4({
      ...f.context,
      permittedSections: () =>
        Promise.reject(
          new Error("Historical ACK must precede current configuration"),
        ),
      gates: {
        ...f.context.gates,
        acquisition: () =>
          Promise.reject(
            new Error("Historical ACK must precede current gates"),
          ),
      },
    });
    f.useDescriptions(() =>
      Promise.reject(
        new Error("Completed ACK must not repeat predecessor observations"),
      ),
    );
    expect(
      await ackOnly.reconcileMovieIntentV4(
        queued.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "available", attemptId: null });
    expect(await f.journalEvidence()).toEqual(journals);
    expect(await f.fileEvidence()).toEqual(files);
    expect(
      await f.db.operation.count({
        where: { kind: "acquire_movie_subtitles_v4", targetId: assetId },
      }),
    ).toBe(2);
    expect(
      await f.db.operation.count({
        where: { idempotencyKey: `seed:${torrentId}` },
      }),
    ).toBe(1);
  },
  60_000,
);

test("a fresh completed retry resolves its exact current binding and original receipt without recreating a reservation", async () => {
  const f = await h.fixture("uncut_version", "plex");
  const input = await attemptInput(f, f.input.operationId);
  await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
  await f.finishMediaOperation({
    operationId: f.input.operationId,
    status: "completed",
    reason: null,
  });
  const before = await f.evidence();
  expect(
    await f.db.acquisitionReservation.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  f.useDescriptions(() =>
    Promise.reject(
      new Error("A completed historical ACK needs no terminal observations"),
    ),
  );
  const queued = await f.retry();
  expect(
    await f.movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "available", attemptId: null });
  expect(await f.evidence()).toEqual(before);
  expect(
    await f.db.acquisitionReservation.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
}, 60_000);
