import { afterEach, beforeAll, expect, test } from "vitest";
import { MovieHistoryDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PrismaMovieHistoryReviews } from "./service.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("a real named request supplies explicit cut consent without changing its immutable choice or household grant", async () => {
  const f = await createMovieHistoryFixture("directors_cut", bytes);
  closers.push(f.close);
  const requested = await f.request();
  const choice = await f.db.movieEditionChoice.findUniqueOrThrow({
    where: { id: requested.choiceId },
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: requested.requestId },
  });
  const review = await f.prepare();
  const input = {
    schemaVersion: 3 as const,
    scope: f.scope,
    scopeHash: review.detail.scopeHash,
    subjectUserId: f.owner.id,
    definition: review.detail.scope.definition,
    registryVersion: 1 as const,
    claimAcknowledgements: [],
    acknowledgeMissingHistory: true as const,
  };
  await expect(
    f.service.respond(
      f.owner,
      crypto.randomUUID(),
      review.result.recoveryReviewId,
      { ...input, declaration: { intent: "no_longer_request" } },
    ),
  ).rejects.toMatchObject({ code: "movie_history_review_changed" });
  expect(await f.db.recoveryResponse.count()).toBe(0);
  await f.service.respond(
    f.owner,
    crypto.randomUUID(),
    review.result.recoveryReviewId,
    {
      ...input,
      declaration: {
        intent: "request",
        currentChoice: {
          requestId: request.id,
          requestVersion: request.version,
          choiceId: choice.id,
          choiceRevision: choice.choiceRevision,
          subtitleLanguages: request.subtitleLanguages,
        },
      },
    },
  );
  await f.declareRemaining(review.result.recoveryReviewId);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, review.result.recoveryReviewId),
  );
  await f.service.release(f.owner, crypto.randomUUID(), ready.id, {
    schemaVersion: 3,
    scope: f.scope,
    expectedVersion: ready.version,
    scopeHash: ready.scopeHash,
    responseHash: ready.responseHash,
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
  expect(
    await f.db.movieEditionChoice.findUniqueOrThrow({
      where: { id: choice.id },
    }),
  ).toEqual(choice);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).toEqual(request);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toMatchObject({ monitoring: true, libraryMonitoring: true });
}, 60_000);

test("an actual scoped cancellation requires a fresh review and cannot be replaced by a negative declaration", async () => {
  const f = await createMovieHistoryFixture("extended_cut", bytes);
  closers.push(f.close);
  const requested = await f.request();
  const choice = await f.db.movieEditionChoice.findUniqueOrThrow({
    where: { id: requested.choiceId },
  });
  const initial = await f.prepare();
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: requested.requestId },
  });
  await f.commands.cancelMovieEditionRequest(f.owner, crypto.randomUUID(), {
    schemaVersion: 3,
    scope: f.scope,
    requestId: request.id,
    subjectUserId: f.owner.id,
    action: "cancel_request",
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  const response = {
    schemaVersion: 3 as const,
    scope: f.scope,
    subjectUserId: f.owner.id,
    registryVersion: 1 as const,
    declaration: { intent: "no_longer_request" as const },
    claimAcknowledgements: [],
    acknowledgeMissingHistory: true as const,
  };
  await expect(
    f.service.respond(
      f.owner,
      crypto.randomUUID(),
      initial.result.recoveryReviewId,
      {
        ...response,
        scopeHash: initial.detail.scopeHash,
        definition: initial.detail.scope.definition,
      },
    ),
  ).rejects.toMatchObject({ code: "movie_history_review_changed" });
  const fresh = await f.prepare();
  await f.service.respond(
    f.owner,
    crypto.randomUUID(),
    fresh.result.recoveryReviewId,
    {
      ...response,
      scopeHash: fresh.detail.scopeHash,
      definition: fresh.detail.scope.definition,
    },
  );
  await f.declareRemaining(fresh.result.recoveryReviewId);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, fresh.result.recoveryReviewId),
  );
  await f.service.release(f.owner, crypto.randomUUID(), ready.id, {
    schemaVersion: 3,
    scope: f.scope,
    expectedVersion: ready.version,
    scopeHash: ready.scopeHash,
    responseHash: ready.responseHash,
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
  expect(
    await f.db.movieEditionChoice.findUniqueOrThrow({
      where: { id: choice.id },
    }),
  ).toEqual(choice);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).toMatchObject({
    active: false,
    excluded: true,
    movieEditionChoiceId: null,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toMatchObject({ monitoring: true, libraryMonitoring: true });
}, 60_000);

test("the original pre-spent99 review allowance protects before any new review, release or command", async () => {
  const f = await createMovieHistoryFixture("final_cut", bytes);
  closers.push(f.close);
  const reviewed = await f.prepare();
  const original = await f.db.recoveryHold.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  const operations = await f.db.operation.count();
  const events = await f.db.applicationEvent.count();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    new PrismaMovieHistoryReviews(f.db, f.settings, { budget }).prepare(
      f.owner,
      crypto.randomUUID(),
      reviewed.input,
    ),
  ).rejects.toThrow("100 total queried records");
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(await f.db.recoveryReview.count()).toBe(1);
  expect(await f.db.recoveryReleaseReceipt.count()).toBe(0);
  expect(await f.db.operation.count()).toBe(operations);
  expect(await f.db.applicationEvent.count()).toBe(events);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toEqual(original);
}, 60_000);
