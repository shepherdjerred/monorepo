import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  type ReleaseMovieHistoryV3Schema,
  MovieHistoryStoredResponseV3Schema,
  MovieHistoryClaimAccountingV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { claimAccounting } from "#infrastructure/recovery/legacy-claims/accounting.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueOperation } from "#automation/store.ts";
import { validateMovieHistoryConsentV3 } from "./consent.ts";
import { movieHistoryConflict } from "./locks.ts";
import {
  type currentMovieHistoryReviewV3,
  movieHistoryHash,
} from "./current.ts";
import { movieHistoryResponseJsonV3 } from "./view.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { reserveMovieHistorySqlV3 } from "./read-costs.ts";
import { bindMovieHistoryDeadlineV3 } from "./deadline.ts";

/** Validate declarations already made through real commands; releasing history grants no new ownership. */
export async function releaseMovieHistoryV3(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    input: z.infer<typeof ReleaseMovieHistoryV3Schema>;
    current: Awaited<ReturnType<typeof currentMovieHistoryReviewV3>>;
    observed: { wall: number; monotonic: number };
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { review, scope } = input.current;
  const command = input.input;
  if (
    movieHistoryHash(command.scope) !== movieHistoryHash(scope.scope) ||
    command.expectedVersion !== review.version ||
    command.scopeHash !== review.scopeHash ||
    scope.blockers.length > 0 ||
    !(await lockRuntimeAuthority(tx, scope.recoveryEpoch))
  )
    throw movieHistoryConflict(
      "Review current responses and resolve all selected-cut household blockers before release",
    );
  const responses = await tx.recoveryResponse.findMany({
    where: { reviewId: review.id },
    orderBy: { userId: "asc" },
    take: 101,
  });
  budget.consume(responses.length);
  if (
    responses.length !== scope.users.length ||
    scope.users.some(
      (subject) => !responses.some((row) => row.userId === subject.id),
    )
  )
    throw movieHistoryConflict(
      "Every applicable person must explicitly respond; silence cannot release history",
    );
  if (
    movieHistoryHash(movieHistoryResponseJsonV3(responses)) !==
    command.responseHash
  )
    throw movieHistoryConflict(
      "The reviewed immutable household responses changed",
    );
  const guards = [];
  const declarations = [];
  for (const row of responses) {
    const response = MovieHistoryStoredResponseV3Schema.parse(row.response);
    declarations.push(response);
    if (
      response.subjectUserId !== row.userId ||
      response.scopeHash !== review.scopeHash ||
      movieHistoryHash(response.scope) !== movieHistoryHash(scope.scope) ||
      movieHistoryHash(response.definition) !==
        movieHistoryHash(scope.definition) ||
      movieHistoryHash(response.claimAcknowledgements) !==
        movieHistoryHash(
          scope.users.find((subject) => subject.id === row.userId)
            ?.claimAcknowledgements,
        )
    )
      throw new Error(
        "Movie history response lost its exact immutable review parent",
      );
    const current = await validateMovieHistoryConsentV3(
      tx,
      { scope, response, actorId: row.actorId },
      budget,
    );
    if (
      movieHistoryHash(current.authority) !==
      movieHistoryHash(response.authority)
    )
      throw movieHistoryConflict(
        "A declaration's actor or subject authority changed; prepare a fresh review",
      );
    guards.push(current.freshness);
  }
  reserveMovieHistorySqlV3(budget, {
    phase: "release",
    scope,
    reads: input.current.sql,
    responses: declarations,
  });
  await bindMovieHistoryDeadlineV3(tx, {
    observed: input.observed,
    guards: [input.current.freshness, ...guards],
  });
  const receipt = await tx.recoveryReleaseReceipt.create({
    data: {
      reviewId: review.id,
      actorId: input.actorId,
      recoveryEpoch: scope.recoveryEpoch,
      scopeHash: review.scopeHash,
      responseHash: command.responseHash,
      releasedHoldIds: [scope.scope.mediaId],
      claimAccounting: MovieHistoryClaimAccountingV3Schema.parse({
        schemaVersion: 3,
        scope: scope.scope,
        claims: claimAccounting(scope.legacyClaims),
      }),
    },
  });
  const changed = await tx.recoveryHold.updateMany({
    where: {
      mediaId: scope.scope.mediaId,
      edition: scope.scope.edition,
      version: scope.hold.version,
      recoveryEpoch: scope.recoveryEpoch,
      releasedAt: null,
    },
    data: {
      releasedAt: new Date(),
      releasedById: input.actorId,
      version: { increment: 1 },
      releaseEvidence: {
        schemaVersion: 3,
        scope: scope.scope,
        reviewId: review.id,
        receiptId: receipt.id,
        scopeHash: review.scopeHash,
        responseHash: command.responseHash,
        confirmHouseholdBaseline: true,
        confirmExistingPins: true,
        acknowledgeMissingHistory: true,
      },
    },
  });
  if (changed.count !== 1)
    throw movieHistoryConflict("The selected-cut recovery hold changed");
  await tx.retentionDecision.updateMany({
    where: {
      mediaId: scope.scope.mediaId,
      edition: scope.scope.edition,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: {
      state: "cancelled",
      warningAcceptedAt: null,
      graceUntil: null,
      version: { increment: 1 },
    },
  });
  const target = await tx.mediaIntent.update({
    where: {
      mediaId_edition: {
        mediaId: scope.scope.mediaId,
        edition: scope.scope.edition,
      },
    },
    data: { generation: { increment: 1 }, version: { increment: 1 } },
  });
  await tx.mediaItem.update({
    where: { id: scope.scope.mediaId },
    data: { version: { increment: 1 } },
  });
  const operationId = await queueOperation(tx, {
    kind: "retain_movie_edition_v4",
    targetId: scope.scope.mediaId,
    userId: input.actorId,
    key: `movie-history-release:${review.id}`,
    budget,
    availableAt: new Date(),
    payload: {
      schemaVersion: 4,
      scope: scope.scope,
      mediaId: scope.scope.mediaId,
      generation: target.generation,
    },
  });
  await tx.recoveryReview.update({
    where: { id: review.id },
    data: { state: "released", version: { increment: 1 } },
  });
  await tx.applicationEvent.create({
    data: {
      actorId: input.actorId,
      mediaId: scope.scope.mediaId,
      kind: "movie_history_reconciled_v3",
      dedupeKey: `movie-history-release-v3:${review.id}`,
      payload: {
        schemaVersion: 3,
        scope: scope.scope,
        reviewId: review.id,
        receiptId: receipt.id,
        scopeHash: review.scopeHash,
        responseHash: command.responseHash,
        responsesRaw: canonicalJson(
          nativeJson(movieHistoryResponseJsonV3(responses)),
        ),
        recoveryEpoch: scope.recoveryEpoch,
        generation: target.generation,
        operationId,
      },
    },
  });
  for (const guard of guards) guard.assertActive();
  return {
    guards,
    result: {
      recoveryReviewId: review.id,
      recoveryReceiptId: receipt.id,
      operationId,
      status: "completed",
      version: review.version + 1,
    },
  };
}
