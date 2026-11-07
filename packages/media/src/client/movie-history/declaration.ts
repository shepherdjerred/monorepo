import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { RecoverySubjectSchema } from "#shared/recovery.ts";
import {
  MovieHistoryDeclarationV3Schema,
  RespondMovieHistoryV3Schema,
  type MovieHistoryDeclarationV3,
} from "#shared/movie-editions/history-review-v3.ts";
import type {
  MovieHistoryReviewV3,
  MovieHistoryPersonalReviewV3,
} from "./api.ts";
import { movieHistoryReviewViewV3 } from "./api.ts";

export type MovieHistorySubjectV3 = z.infer<typeof RecoverySubjectSchema>;
export type MovieHistoryDeclarationContextV3 = Pick<
  MovieHistoryPersonalReviewV3,
  | "id"
  | "scope"
  | "scopeHash"
  | "definition"
  | "registryVersion"
  | "requests"
  | "choices"
  | "personalHolds"
  | "subject"
  | "response"
>;

export function movieHistoryMayRespondV3(
  user: MediaUser,
  subject: MovieHistorySubjectV3,
) {
  return (
    (subject.id === user.id && subject.declarationAuthority === "self") ||
    (user.role === "owner" &&
      !user.restricted &&
      subject.declarationAuthority === "managed_owner" &&
      subject.mappingKind === "managed" &&
      subject.homeUserId !== null)
  );
}

export function movieHistorySubjectsV3(
  review: MovieHistoryReviewV3,
  user: MediaUser,
) {
  const view = movieHistoryReviewViewV3(review);
  if (view.kind === "personal") {
    if (view.review.subject.id !== user.id)
      throw new Error("Personal history belongs to another person");
    return [view.review.subject];
  }
  return view.review.scope.users.filter((subject) =>
    movieHistoryMayRespondV3(user, subject),
  );
}

export function movieHistoryPersonV3(
  review: MovieHistoryReviewV3,
  subject: MovieHistorySubjectV3,
): MovieHistoryDeclarationContextV3 {
  const view = movieHistoryReviewViewV3(review);
  if (view.kind === "personal") {
    if (subject.id !== view.review.subject.id)
      throw new Error("Personal history cannot project another subject");
    return view.review;
  }
  const owner = view.review;
  const requests = owner.scope.requests.filter(
    (row) => row.userId === subject.id,
  );
  const choiceIds = new Set(
    requests.flatMap((row) =>
      row.movieEditionChoiceId === null ? [] : [row.movieEditionChoiceId],
    ),
  );
  return {
    id: review.id,
    scope: owner.scope.scope,
    scopeHash: review.scopeHash,
    definition: owner.scope.definition,
    registryVersion: owner.scope.registryVersion,
    subject,
    requests,
    choices: owner.scope.choices.filter((row) => choiceIds.has(row.id)),
    personalHolds: owner.scope.personalHolds.filter(
      (row) => row.userId === subject.id,
    ),
    response:
      owner.responses.find((row) => row.userId === subject.id)?.response ??
      null,
  };
}

export function movieHistoryCurrentChoiceV3(
  person: MovieHistoryDeclarationContextV3,
) {
  const requests = person.requests.filter(
    (row) =>
      row.userId === person.subject.id &&
      row.active &&
      !row.excluded &&
      row.direct,
  );
  if (requests.length > 1)
    throw new Error("Captured requests have competing selected-cut choices");
  const request = requests[0];
  if (request?.movieEditionChoiceId == null) return null;
  const choice = person.choices.find(
    (row) => row.id === request.movieEditionChoiceId,
  );
  if (
    choice?.requestId !== request.id ||
    choice.subjectUserId !== person.subject.id ||
    choice.rootMediaId !== person.scope.mediaId ||
    choice.edition !== person.scope.edition ||
    choice.choiceRevision !== request.movieEditionChoiceRevision
  )
    throw new Error("Captured movie choice differs from its current request");
  return {
    requestId: request.id,
    requestVersion: request.version,
    choiceId: choice.id,
    choiceRevision: choice.choiceRevision,
    subtitleLanguages: request.subtitleLanguages,
  };
}

export function movieHistoryResponseV3(
  person: MovieHistoryDeclarationContextV3,
  intent: MovieHistoryDeclarationV3["intent"],
  keepId: string,
) {
  let declaration: MovieHistoryDeclarationV3;
  if (intent === "no_longer_request") {
    if (person.requests.some((row) => row.active && !row.excluded))
      throw new Error(
        "Cancel the real edition request, then ask the owner for a fresh review.",
      );
    declaration = { intent };
  } else {
    const currentChoice = movieHistoryCurrentChoiceV3(person);
    if (currentChoice === null)
      throw new Error(
        "Choose this edition before the owner captures a fresh review.",
      );
    if (intent === "keep") {
      const currentKeep = person.personalHolds.find(
        (row) =>
          row.id === keepId &&
          row.userId === person.subject.id &&
          row.mediaId === person.scope.mediaId &&
          row.edition === person.scope.edition &&
          (row.isPin ||
            (row.until !== null && Date.parse(row.until) > Date.now())),
      );
      if (currentKeep === undefined)
        throw new Error(
          "Select an actual captured Keep or pin for this edition.",
        );
      declaration = { intent, currentChoice, currentKeep };
    } else declaration = { intent, currentChoice };
  }
  return RespondMovieHistoryV3Schema.parse({
    schemaVersion: 3,
    scope: person.scope,
    scopeHash: person.scopeHash,
    subjectUserId: person.subject.id,
    definition: person.definition,
    registryVersion: person.registryVersion,
    declaration: MovieHistoryDeclarationV3Schema.parse(declaration),
    claimAcknowledgements: person.subject.claimAcknowledgements,
    acknowledgeMissingHistory: true,
  });
}
