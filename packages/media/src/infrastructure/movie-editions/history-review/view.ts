import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
  MovieHistoryScopeV3Schema,
  MovieHistoryStoredResponseV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import {
  movieChoiceSubject,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieHistoryHash } from "./current.ts";

type Response = Prisma.RecoveryResponseGetPayload<Record<string, never>>;
export function movieHistoryResponseJsonV3(responses: Response[]) {
  return responses.map((row) => ({
    userId: row.userId,
    actorId: row.actorId,
    response: row.response,
  }));
}

export async function movieHistoryViewV3(
  tx: Prisma.TransactionClient,
  input: { actorId: string; id: string; access: MovieChoiceAccess },
) {
  const review = await tx.recoveryReview.findUnique({
    where: { id: input.id },
    include: {
      responses: { orderBy: { userId: "asc" }, take: 101 },
      receipt: true,
    },
  });
  if (review === null)
    throw new MediaError(
      "recovery_not_found",
      "Movie history review does not exist",
      404,
    );
  if (review.responses.length > 100)
    throw new Error(
      "Movie history response inventory exceeds its native bound",
    );
  const scope = MovieHistoryScopeV3Schema.parse(review.scope);
  const user = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.actorId },
  });
  const base = {
    id: review.id,
    state: review.state,
    version: review.version,
    scopeHash: review.scopeHash,
    expiresAt: review.expiresAt.toISOString(),
  };
  if (user.role === "owner" && !user.restricted)
    return MovieHistoryDetailV3Schema.parse({
      ...base,
      scope,
      responseHash: movieHistoryHash(
        movieHistoryResponseJsonV3(review.responses),
      ),
      responses: review.responses.map((row) => ({
        userId: row.userId,
        actorId: row.actorId,
        response: row.response,
        createdAt: row.createdAt.toISOString(),
      })),
      missingUserIds: scope.users
        .filter(
          (subject) =>
            !review.responses.some((row) => row.userId === subject.id),
        )
        .map((subject) => subject.id),
      receiptId: review.receipt?.id ?? null,
    });
  const subject = scope.users.find((row) => row.id === user.id);
  if (subject === undefined)
    throw new MediaError(
      "recovery_forbidden",
      "This review has no applicable selected cut for this person",
      403,
    );
  const authority = await movieChoiceSubject(tx, {
    actorId: user.id,
    subjectUserId: user.id,
    purpose: "choose",
    access: input.access,
    mediaSectionId: input.access.movieSectionId,
  });
  const requests = scope.requests.filter((row) => row.userId === user.id);
  const choiceIds = new Set(
    requests.flatMap((row) =>
      row.movieEditionChoiceId === null ? [] : [row.movieEditionChoiceId],
    ),
  );
  const response = review.responses.find((row) => row.userId === user.id);
  const result = MovieHistoryPersonalDetailV3Schema.parse(
    nativeJson({
      ...base,
      scope: scope.scope,
      definition: scope.definition,
      registryVersion: scope.registryVersion,
      title: scope.media.title,
      subject,
      requests,
      choices: scope.choices.filter((row) => choiceIds.has(row.id)),
      personalHolds: scope.personalHolds.filter(
        (row) => row.userId === user.id,
      ),
      response:
        response === undefined
          ? null
          : MovieHistoryStoredResponseV3Schema.parse(response.response),
    }),
  );
  authority.freshness?.assertActive();
  return result;
}
