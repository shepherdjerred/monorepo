import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryClaimAccountingV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { PrismaMovieHistoryReviews } from "./service.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
const checksum = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test.each(MovieEditionKeySchema.options)(
  "actual %s initial-library history release preserves ownership and independent household monitoring",
  async (edition) => {
    const f = await createMovieHistoryFixture(edition, bytes);
    closers.push(f.close);
    const targetWhere = {
      mediaId_edition: { mediaId: f.scope.mediaId, edition },
    };
    const target = await f.db.mediaIntent.findUniqueOrThrow({
      where: targetWhere,
    });
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.original.asset.id },
    });
    const pointer = await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: targetWhere,
    });
    const receipt = await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.original.receiptId },
    });
    const plan = await f.db.mediaHandoffPlan.findUniqueOrThrow({
      where: { id: receipt.planId },
    });
    const review = await f.prepare();
    expect(review.detail.scope).toMatchObject({
      schemaVersion: 3,
      scope: f.scope,
      blockers: [],
      requests: [],
      choices: [],
      target: { libraryMonitoring: true, monitoring: true },
      adoption: { receiptId: receipt.id, planHash: receipt.planHash },
    });
    expect(review.detail.scope.users.map((user) => user.id).sort()).toEqual(
      f.household.map((person) => person.id).sort(),
    );
    await f.service.respond(
      f.owner,
      crypto.randomUUID(),
      review.result.recoveryReviewId,
      {
        schemaVersion: 3,
        scope: f.scope,
        scopeHash: review.detail.scopeHash,
        subjectUserId: f.owner.id,
        definition: review.detail.scope.definition,
        registryVersion: 1,
        declaration: { intent: "no_longer_request" },
        claimAcknowledgements: [],
        acknowledgeMissingHistory: true,
      },
    );
    await f.declareRemaining(review.result.recoveryReviewId);
    const ready = MovieHistoryDetailV3Schema.parse(
      await f.service.detail(f.owner, review.result.recoveryReviewId),
    );
    expect(ready.responses).toHaveLength(f.household.length);
    const input = {
      schemaVersion: 3 as const,
      scope: f.scope,
      expectedVersion: ready.version,
      scopeHash: ready.scopeHash,
      responseHash: ready.responseHash,
      confirmHouseholdBaseline: true as const,
      confirmExistingPins: true as const,
      acknowledgeMissingHistory: true as const,
    };
    const key = crypto.randomUUID();
    const released = await f.service.release(f.owner, key, ready.id, input);
    const hold = await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere,
    });
    expect(hold).toMatchObject({
      releasedById: f.owner.id,
      version: review.detail.scope.hold.version + 1,
      releaseEvidence: {
        schemaVersion: 3,
        scope: f.scope,
        reviewId: ready.id,
        receiptId: released.recoveryReceiptId,
      },
    });
    expect(hold.releasedAt).toBeInstanceOf(Date);
    const after = await f.db.mediaIntent.findUniqueOrThrow({
      where: targetWhere,
    });
    expect(after).toMatchObject({
      generation: target.generation + 1,
      version: target.version + 1,
      desiredPresence: target.desiredPresence,
      monitoring: target.monitoring,
      libraryMonitoring: target.libraryMonitoring,
      profileId: target.profileId,
      availability: target.availability,
      automationEpoch: target.automationEpoch,
    });
    const ledger = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { reviewId: ready.id },
    });
    expect(
      MovieHistoryClaimAccountingV3Schema.parse(ledger.claimAccounting),
    ).toEqual({ schemaVersion: 3, scope: f.scope, claims: [] });
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(released.operationId) },
    });
    expect(operation.kind).toBe("retain_movie_edition_v4");
    expect(operation.payload).toMatchObject({
      schemaVersion: 4,
      scope: f.scope,
      generation: after.generation,
      mediaId: f.scope.mediaId,
    });
    expect(
      await new PrismaMovieHistoryReviews(f.db, {
        keepDays: 30,
        movieAccess: () =>
          Promise.reject(
            new Error(
              "Historical review ACK must precede changed configuration",
            ),
          ),
      }).release(f.owner, key, ready.id, input),
    ).toEqual(released);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toEqual(asset);
    expect(
      await f.db.plexBindingCurrent.findUniqueOrThrow({ where: targetWhere }),
    ).toEqual(pointer);
    expect(
      await f.db.mediaHandoffReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    ).toEqual(receipt);
    expect(
      await f.db.mediaHandoffPlan.findUniqueOrThrow({ where: { id: plan.id } }),
    ).toEqual(plan);
    expect(
      await f.db.mediaRequest.count({
        where: { mediaId: f.scope.mediaId, edition },
      }),
    ).toBe(0);
    expect(
      await f.db.movieEditionChoice.count({
        where: { rootMediaId: f.scope.mediaId, edition },
      }),
    ).toBe(0);
    expect(await f.db.acquisitionAttempt.count()).toBe(0);
    const actual = await readFile(f.original.target);
    expect({ bytes: actual.byteLength, checksum: checksum(actual) }).toEqual({
      bytes: bytes.byteLength,
      checksum: checksum(bytes),
    });
  },
  60_000,
);
