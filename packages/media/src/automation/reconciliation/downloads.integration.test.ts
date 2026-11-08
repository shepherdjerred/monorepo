import { expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieRetryBirthHash } from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";

type Fixture = Awaited<ReturnType<typeof createMovieWorkflowFixture>>;

async function reserve(f: Fixture, index: number, bytes: Uint8Array) {
  const media =
    index === 0
      ? f.source.media
      : await f.source.db.mediaItem.create({
          data: {
            kind: "movie",
            title: "Workflow Fixture",
            year: 2020,
            tmdbId: 101_010 + index,
            runtimeMinutes: 1,
            originalLanguage: "en",
          },
        });
  const wire =
    index === 0
      ? f.source.wire
      : movieWorkflowWire(f.source.db, {
          mediaId: media.id,
          edition: "extended_cut",
          bytes,
          downloads: f.source.files.roots.movies.downloads,
          providerReleaseId: `download-sweep-${String(index)}`,
        });
  const context = { ...f.source.context, ...wire };
  const request =
    index === 0
      ? { input: f.input }
      : await requestTestMovieV4(
          f.source.db,
          f.source.user,
          media.id,
          "extended_cut",
        );
  const movie = createMovieNetworkFacetV4(context);
  const reserved = await movie.reconcileMovieIntentV4(
    request.input,
    testPlexBindingExecution(),
  );
  expect(reserved.status).toBe("acquire");
  const input: MovieAttemptOperationV4 = {
    schemaVersion: 4,
    operationId: request.input.operationId,
    scope: request.input.scope,
    attemptId: z.uuid().parse(reserved.attemptId),
  };
  return { input, movie, wire, context };
}

test("download Activity pages advance past active movies to uncertain adds and stopped coordinators within each original allowance", async ({
  onTestFinished,
}) => {
  const bytes = await movieVideoFixture();
  const f = await createMovieWorkflowFixture("extended_cut", { bytes });
  onTestFinished(() => f.close());
  const db = f.source.db;
  const attempts = [];
  for (let index = 0; index < 11; index++)
    attempts.push(await reserve(f, index, bytes));
  attempts.sort((a, b) => a.input.attemptId.localeCompare(b.input.attemptId));
  const uncertain = attempts.at(-2);
  const stopped = attempts.at(-1);
  if (uncertain === undefined || stopped === undefined)
    throw new Error("Actual sweep tail is missing");
  uncertain.wire.control.loseAddReply = true;
  for (const attempt of attempts) {
    const submitted = await attempt.movie.submitMovieTorrentV4(
      attempt.input,
      testPlexBindingExecution(),
    );
    expect(submitted).toEqual(
      attempt === uncertain
        ? { status: "blocked", reason: "outcome-unknown" }
        : { status: "submitted", reason: null },
    );
    expect(attempt.wire.additions()).toBe(1);
  }
  const births = await db.acquisitionAttempt.findMany({
    orderBy: { id: "asc" },
  });
  const unknownBirth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: uncertain.input.attemptId },
  });
  expect(unknownBirth).toMatchObject({
    state: "submission_unknown",
    torrentId: null,
  });
  uncertain.wire.control.visible = false;
  await f.finishMediaOperation({
    operationId: stopped.input.operationId,
    status: "reconciling",
    reason: "movie_operation_failed",
  });
  const observed: string[] = [];
  const context = {
    ...uncertain.context,
    describeWorkflow: (id: string) => {
      observed.push(id);
      return Promise.resolve(
        id === `media-operation-${stopped.input.operationId}`
          ? { status: "TERMINATED" as const, runId: "stopped-root" }
          : id === `media-acquire-${stopped.input.attemptId}`
            ? { status: "COMPLETED" as const, runId: "stopped-child" }
            : { status: "RUNNING" as const, runId: "active-root" },
      );
    },
  };
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(99);
  const exhaustedExecution = testPlexBindingExecution();
  await expect(
    createSweepActivities({
      ...context,
      movieManagement: { execution: exhaustedExecution, budget: exhausted },
    }).sweepMediaWork({
      kind: "downloads",
      cursor: "00000000-0000-0000-0000-000000000000",
      sweepId: "exhausted-download-page",
    }),
  ).rejects.toThrow("100 total queried records");
  expect(() => exhausted.consume(0)).toThrow("100 total queried records");
  expect(
    await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(births);
  const page = async (cursor: string | null) => {
    const execution = testPlexBindingExecution();
    const budget = new PublicationAuthorityReadBudget();
    const result = await createSweepActivities({
      ...context,
      movieManagement: { execution, budget },
    }).sweepMediaWork({ kind: "downloads", cursor, sweepId: "download-pages" });
    expect(() => budget.consume(0)).not.toThrow();
    return { ...result, paid: 101 - budget.take };
  };
  let cursor: string | null = null;
  let leadingPaid = 0;
  for (const [index, attempt] of attempts.entries()) {
    const result = await page(cursor);
    expect(result).toMatchObject({
      processed: 1,
      nextCursor: attempt.input.attemptId,
    });
    if (index < 9) leadingPaid += result.paid;
    cursor = result.nextCursor;
  }
  expect(leadingPaid + 2).toBeGreaterThan(100);
  expect(await page(cursor)).toMatchObject({ processed: 0, nextCursor: null });
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: unknownBirth.id },
    }),
  ).toEqual(unknownBirth);
  const key = `movie-retry-recover-v4:${stopped.input.attemptId}:${stopped.input.operationId}:stopped-root:stopped-child`;
  const recovery = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: key },
    include: { outbox: true },
  });
  expect(recovery).toMatchObject({
    kind: "reconcile_movie_edition_v4",
    targetId: stopped.input.scope.mediaId,
    outbox: { kind: "reconcile_movie_edition_v4", dispatchedAt: null },
    payload: {
      movieRetryV1: {
        attemptId: stopped.input.attemptId,
        previousCoordinatorOperationId: stopped.input.operationId,
      },
    },
  });
  expect(observed).toContain(`media-acquire-${stopped.input.attemptId}`);
  uncertain.wire.control.visible = true;
  const beforeUnknown = attempts.at(-3);
  if (beforeUnknown === undefined)
    throw new Error("Actual preceding cursor is missing");
  expect(await page(beforeUnknown.input.attemptId)).toMatchObject({
    processed: 1,
    nextCursor: unknownBirth.id,
  });
  const reconciled = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: unknownBirth.id },
  });
  expect(movieRetryBirthHash(reconciled)).toBe(
    movieRetryBirthHash(unknownBirth),
  );
  const torrentId = z.uuid().parse(reconciled.torrentId);
  expect(
    await db.torrent.findUniqueOrThrow({ where: { id: torrentId } }),
  ).toMatchObject({ owned: true, ownershipEpoch: unknownBirth.recoveryEpoch });
  expect(
    await db.operation.count({
      where: { idempotencyKey: `seed:${torrentId}` },
    }),
  ).toBe(1);
  expect(await page(unknownBirth.id)).toMatchObject({
    processed: 1,
    nextCursor: stopped.input.attemptId,
  });
  expect(await db.operation.count({ where: { idempotencyKey: key } })).toBe(1);
  const after = await db.acquisitionAttempt.findMany({
    orderBy: { id: "asc" },
  });
  expect(after.map((attempt) => movieRetryBirthHash(attempt))).toEqual(
    births.map((attempt) => movieRetryBirthHash(attempt)),
  );
  for (const attempt of attempts) expect(attempt.wire.additions()).toBe(1);
}, 60_000);
