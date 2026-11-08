import { expect, it } from "vitest";
import { UserSchema } from "#shared/contract.ts";
import {
  movieHistoryCurrentChoiceV3,
  movieHistoryMayRespondV3,
  movieHistoryResponseV3,
  movieHistorySubjectsV3,
} from "./declaration.ts";
import { movieHistoryPersonalFixtureV3 } from "./test-support.ts";

it("declares the exact captured choice, caption order, imported claims and existing Keep without creating consent", () => {
  const { review } = movieHistoryPersonalFixtureV3();
  const keep = review.personalHolds[0];
  const request = review.requests[0];
  if (keep === undefined || request === undefined)
    throw new Error("Captured test choice and hold required");
  const response = movieHistoryResponseV3(review, "keep", keep.id);
  expect(response).toMatchObject({
    scope: review.scope,
    scopeHash: review.scopeHash,
    definition: review.definition,
    subjectUserId: review.subject.id,
    registryVersion: 1,
    declaration: {
      intent: "keep",
      currentChoice: {
        requestId: request.id,
        requestVersion: 7,
        choiceId: request.movieEditionChoiceId,
        choiceRevision: 2,
        subtitleLanguages: ["zh-Hans", "en"],
      },
      currentKeep: keep,
    },
    claimAcknowledgements: review.subject.claimAcknowledgements,
    acknowledgeMissingHistory: true,
  });
  expect(() =>
    movieHistoryResponseV3(review, "keep", crypto.randomUUID()),
  ).toThrow("actual captured Keep");
  expect(() => movieHistoryResponseV3(review, "no_longer_request", "")).toThrow(
    "Cancel the real edition request",
  );
});

it("never converts an active legacy request into a choice or a negative declaration", () => {
  const { review } = movieHistoryPersonalFixtureV3();
  const request = review.requests[0];
  if (request === undefined) throw new Error("Captured test request required");
  request.movieEditionChoiceId = null;
  review.choices = [];
  expect(movieHistoryCurrentChoiceV3(review)).toBeNull();
  expect(() => movieHistoryResponseV3(review, "request", "")).toThrow(
    "Choose this edition",
  );
  expect(() => movieHistoryResponseV3(review, "no_longer_request", "")).toThrow(
    "Cancel the real edition request",
  );
  request.active = false;
  expect(
    movieHistoryResponseV3(review, "no_longer_request", "").declaration,
  ).toEqual({ intent: "no_longer_request" });
});

it("rejects another edition's choice and an expired or foreign Keep rather than substituting defaults", () => {
  const { review } = movieHistoryPersonalFixtureV3();
  const choice = review.choices[0];
  const keep = review.personalHolds[0];
  if (choice === undefined || keep === undefined)
    throw new Error("Captured test choice and hold required");
  choice.edition = "theatrical_cut";
  expect(() => movieHistoryCurrentChoiceV3(review)).toThrow(
    "differs from its current request",
  );
  choice.edition = "directors_cut";
  keep.until = "2000-01-01T00:00:00.000Z";
  expect(() => movieHistoryResponseV3(review, "keep", keep.id)).toThrow(
    "actual captured Keep",
  );
  keep.isPin = true;
  keep.userId = crypto.randomUUID();
  expect(() => movieHistoryResponseV3(review, "keep", keep.id)).toThrow(
    "actual captured Keep",
  );
});

it("allows owner proxy only for an exact captured managed Home subject and preserves personal redaction", () => {
  const { user, review } = movieHistoryPersonalFixtureV3();
  const owner = UserSchema.parse({
    ...user,
    id: crypto.randomUUID(),
    role: "owner",
  });
  expect(movieHistoryMayRespondV3(owner, review.subject)).toBe(false);
  const managed = {
    ...review.subject,
    declarationAuthority: "managed_owner" as const,
    mappingKind: "managed",
    homeUserId: "710004",
  };
  expect(movieHistoryMayRespondV3(owner, managed)).toBe(true);
  expect(
    movieHistoryMayRespondV3({ ...owner, restricted: true }, managed),
  ).toBe(false);
  expect(movieHistoryMayRespondV3(user, managed)).toBe(false);
  expect(
    movieHistoryMayRespondV3(owner, { ...managed, homeUserId: null }),
  ).toBe(false);
  expect(movieHistorySubjectsV3(review, user)).toEqual([review.subject]);
  expect(() => movieHistorySubjectsV3(review, owner)).toThrow(
    "belongs to another person",
  );
});
