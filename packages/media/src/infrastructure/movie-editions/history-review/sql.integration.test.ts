import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { MovieHistoryDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("real-deadline raw SQL cannot re-scope a named hold or manufacture release closure, while real producer closure succeeds", async () => {
  const f = await createMovieHistoryFixture("uncut_version", bytes);
  closers.push(f.close);
  const captured = await f.prepare();
  const where = {
    mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
  };
  const hold = await f.db.recoveryHold.findUniqueOrThrow({ where });
  const sibling = { ...f.scope, edition: "directors_cut" as const };
  const execution = testPlexBindingExecution();
  await expect(
    f.db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, execution);
      await tx.recoveryHold.update({
        where,
        data: {
          releasedAt: new Date(),
          releasedById: f.owner.id,
          version: { increment: 1 },
          releaseEvidence: {
            schemaVersion: 3,
            scope: sibling,
            reviewId: captured.result.recoveryReviewId,
            receiptId: crypto.randomUUID(),
            scopeHash: captured.detail.scopeHash,
            responseHash: identityHash([]),
          },
        },
      });
    }),
  ).rejects.toThrow("actual same-transaction exact-cut v3 release");
  await expect(
    f.db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, execution);
      await tx.recoveryReleaseReceipt.create({
        data: {
          reviewId: captured.result.recoveryReviewId,
          actorId: f.owner.id,
          recoveryEpoch: captured.detail.scope.recoveryEpoch,
          scopeHash: captured.detail.scopeHash,
          responseHash: identityHash([]),
          releasedHoldIds: [f.scope.mediaId],
          claimAccounting: { schemaVersion: 3, scope: sibling, claims: [] },
        },
      });
    }),
  ).rejects.toThrow();
  expect(await f.db.recoveryHold.findUniqueOrThrow({ where })).toEqual(hold);
  expect(await f.db.recoveryReleaseReceipt.count()).toBe(0);
  await f.service.respond(
    f.owner,
    crypto.randomUUID(),
    captured.result.recoveryReviewId,
    {
      schemaVersion: 3,
      scope: f.scope,
      scopeHash: captured.detail.scopeHash,
      subjectUserId: f.owner.id,
      definition: captured.detail.scope.definition,
      registryVersion: 1,
      declaration: { intent: "no_longer_request" },
      claimAcknowledgements: [],
      acknowledgeMissingHistory: true,
    },
  );
  await f.declareRemaining(captured.result.recoveryReviewId);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, captured.result.recoveryReviewId),
  );
  const result = await f.service.release(
    f.owner,
    crypto.randomUUID(),
    ready.id,
    {
      schemaVersion: 3,
      scope: f.scope,
      expectedVersion: ready.version,
      scopeHash: ready.scopeHash,
      responseHash: ready.responseHash,
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    },
  );
  expect(await f.db.recoveryReleaseReceipt.count()).toBe(1);
  expect(await f.db.recoveryHold.findUniqueOrThrow({ where })).toMatchObject({
    releasedById: f.owner.id,
    releaseEvidence: { receiptId: result.recoveryReceiptId, scope: f.scope },
  });
}, 60_000);

test("the actual review capture, response and release marker remain immutable after a genuine committed release", async () => {
  const f = await createMovieHistoryFixture("theatrical_cut", bytes);
  closers.push(f.close);
  const captured = await f.prepare();
  const reviewId = captured.result.recoveryReviewId;
  await f.service.respond(f.owner, crypto.randomUUID(), reviewId, {
    schemaVersion: 3,
    scope: f.scope,
    scopeHash: captured.detail.scopeHash,
    subjectUserId: f.owner.id,
    definition: captured.detail.scope.definition,
    registryVersion: 1,
    declaration: { intent: "no_longer_request" },
    claimAcknowledgements: [],
    acknowledgeMissingHistory: true,
  });
  await f.declareRemaining(reviewId);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, reviewId),
  );
  const result = await f.service.release(
    f.owner,
    crypto.randomUUID(),
    reviewId,
    {
      schemaVersion: 3,
      scope: f.scope,
      expectedVersion: ready.version,
      scopeHash: ready.scopeHash,
      responseHash: ready.responseHash,
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    },
  );
  const receiptId = z.uuid().parse(result.recoveryReceiptId);
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { id: receiptId },
  });
  const review = await f.db.recoveryReview.findUniqueOrThrow({
    where: { id: reviewId },
  });
  const response = await f.db.recoveryResponse.findUniqueOrThrow({
    where: { reviewId_userId: { reviewId, userId: f.owner.id } },
  });
  const capture = await f.db.applicationEvent.findUniqueOrThrow({
    where: { dedupeKey: `movie-history-review-v3:${reviewId}` },
  });
  const event = await f.db.applicationEvent.findUniqueOrThrow({
    where: { dedupeKey: `movie-history-release-v3:${reviewId}` },
  });
  await expect(
    f.db.recoveryReview.update({
      where: { id: reviewId },
      data: { scopeHash: "0".repeat(64) },
    }),
  ).rejects.toThrow();
  await expect(
    f.db.recoveryReview.delete({ where: { id: reviewId } }),
  ).rejects.toThrow();
  await expect(
    f.db.recoveryResponse.delete({ where: { id: response.id } }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.recoveryReleaseReceipt.update({
      where: { id: receiptId },
      data: {
        claimAccounting: {
          schemaVersion: 3,
          scope: { ...f.scope, edition: "directors_cut" },
          claims: [],
        },
      },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.recoveryReleaseReceipt.delete({ where: { id: receiptId } }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.applicationEvent.update({
      where: { id: capture.id },
      data: { payload: { schemaVersion: 3, scope: f.scope } },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.applicationEvent.delete({ where: { id: event.id } }),
  ).rejects.toThrow("immutable");
  expect(
    await f.db.recoveryReview.findUniqueOrThrow({ where: { id: reviewId } }),
  ).toEqual(review);
  expect(
    await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    }),
  ).toEqual(receipt);
  expect(
    await f.db.recoveryResponse.findUniqueOrThrow({
      where: { id: response.id },
    }),
  ).toEqual(response);
  expect(
    await f.db.applicationEvent.findUniqueOrThrow({
      where: { id: capture.id },
    }),
  ).toEqual(capture);
  expect(
    await f.db.applicationEvent.findUniqueOrThrow({ where: { id: event.id } }),
  ).toEqual(event);
}, 60_000);
