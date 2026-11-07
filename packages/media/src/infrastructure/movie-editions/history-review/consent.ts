import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MovieHistoryScopeV3,
  MovieHistoryStoredResponseV3,
} from "#shared/movie-editions/history-review-v3.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieChoiceSubject } from "#infrastructure/movie-editions/access.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieHistoryConflict } from "./locks.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** Declaration observes an existing explicit choice/Keep; it never creates consent. */
export async function validateMovieHistoryConsentV3(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieHistoryScopeV3;
    response: Pick<
      MovieHistoryStoredResponseV3,
      "subjectUserId" | "declaration"
    >;
    actorId: string;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { scope, response } = input;
  const subject = scope.users.find(
    (user) => user.id === response.subjectUserId,
  );
  if (subject === undefined)
    throw movieHistoryConflict(
      "This person is not an applicable reviewed subject",
    );
  const current = await movieChoiceSubject(tx, {
    actorId: input.actorId,
    subjectUserId: subject.id,
    access: scope.access,
    purpose: "choose",
    mediaSectionId: scope.access.movieSectionId,
  });
  if (current.mapping === null || current.freshness === null)
    throw new Error("Movie history subject lost its verified authority");
  const authority = {
    mode:
      current.actor.id === subject.id
        ? ("self" as const)
        : ("managed_owner" as const),
    actorId: current.actor.id,
    actorVersion: current.actor.version,
    subjectUserId: subject.id,
    mappingVersion: current.mapping.version,
  };
  if (response.declaration.intent === "no_longer_request") {
    if (
      scope.requests.some(
        (request) =>
          request.userId === subject.id && request.active && !request.excluded,
      )
    )
      throw movieHistoryConflict(
        "Cancel the actual selected-cut request before preparing a fresh negative declaration",
      );
  } else {
    await validatePositive(tx, { scope, response }, budget);
  }
  current.freshness.assertActive();
  return { authority, freshness: current.freshness };
}

async function validatePositive(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieHistoryScopeV3;
    response: Pick<
      MovieHistoryStoredResponseV3,
      "subjectUserId" | "declaration"
    >;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { scope, response } = input;
  const declaration = response.declaration;
  if (declaration.intent === "no_longer_request")
    throw new Error("Positive movie declaration required");
  const declared = declaration.currentChoice;
  const captured = scope.requests.find((row) => row.id === declared.requestId);
  if (
    captured?.userId !== response.subjectUserId ||
    captured.movieEditionChoiceId !== declared.choiceId ||
    captured.version !== declared.requestVersion ||
    captured.movieEditionChoiceRevision !== declared.choiceRevision ||
    hash(captured.subtitleLanguages) !== hash(declared.subtitleLanguages)
  )
    throw movieHistoryConflict(
      "Declare the actual captured current choice for this cut",
    );
  const current = await readMovieChoice(tx, {
    requestId: captured.id,
    expectedScope: scope.scope,
    access: scope.access,
    budget,
  });
  if (
    current.status !== "authorized" ||
    current.choice.id !== declared.choiceId ||
    current.choice.choiceRevision !== declared.choiceRevision ||
    current.request.version !== declared.requestVersion
  )
    throw movieHistoryConflict(
      "The explicit current movie choice is no longer authorized",
    );
  if (declaration.intent === "keep") {
    const keep = scope.personalHolds.find(
      (row) => row.id === declaration.currentKeep.id,
    );
    if (
      keep?.userId !== response.subjectUserId ||
      hash(keep) !== hash(declaration.currentKeep) ||
      (!keep.isPin &&
        (keep.until === null || Date.parse(keep.until) <= Date.now()))
    )
      throw movieHistoryConflict(
        "Keep requires this person's actual current selected-cut Keep",
      );
  }
  current.freshness.assertActive();
}
