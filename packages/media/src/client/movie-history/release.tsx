import { useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import { ReleaseMovieHistoryV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { humanize } from "#client/components.tsx";
import type {
  MovieHistoryOwnerReviewV3,
  MovieHistoryWriteControllerV3,
} from "./api.ts";

export function MovieHistoryReleaseV3({
  user,
  review,
  command,
  closed,
}: {
  user: MediaUser;
  review: MovieHistoryOwnerReviewV3;
  command: MovieHistoryWriteControllerV3;
  closed: boolean;
}) {
  const [baseline, setBaseline] = useState(false);
  const [pins, setPins] = useState(false);
  const [history, setHistory] = useState(false);
  const complete =
    review.missingUserIds.length === 0 && review.scope.blockers.length === 0;
  const disabled =
    command.blocked ||
    closed ||
    !complete ||
    user.role !== "owner" ||
    user.restricted;
  return (
    <section className="panel">
      <h2>Household declarations</h2>
      <ul>
        {review.scope.users.map((subject) => {
          const response = review.responses.find(
            (row) => row.userId === subject.id,
          );
          return (
            <li key={subject.id}>
              {subject.displayName}:{" "}
              {response === undefined
                ? "Declaration needed"
                : humanize(response.response.declaration.intent)}
              {subject.declarationAuthority === "managed_owner"
                ? " · Managed Home profile"
                : " · Declares for themselves"}
            </li>
          );
        })}
      </ul>
      {review.scope.blockers.length > 0 && (
        <p>
          This capture has unresolved protection. Review the current edition and
          prepare a fresh capture when those facts have been resolved.
        </p>
      )}
      {review.receiptId !== null && (
        <p>
          This edition’s household history hold was released. Existing pins,
          Keep, household monitoring and normal watch, warning and grace
          requirements remain effective.
        </p>
      )}
      {review.receiptId === null && (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !baseline || !pins || !history) return;
            command.submit({
              actorId: user.id,
              path: `/movie-history/reviews/${encodeURIComponent(review.id)}/release`,
              body: ReleaseMovieHistoryV3Schema.parse({
                schemaVersion: 3,
                scope: review.scope.scope,
                expectedVersion: review.version,
                scopeHash: review.scopeHash,
                responseHash: review.responseHash,
                confirmHouseholdBaseline: true,
                confirmExistingPins: true,
                acknowledgeMissingHistory: true,
              }),
            });
          }}
        >
          <fieldset disabled={disabled}>
            <legend>Release only this edition’s history hold</legend>
            <label className="check-label">
              <input
                type="checkbox"
                checked={baseline}
                onChange={(event) => {
                  setBaseline(event.target.checked);
                }}
              />
              Everyone applicable is listed and every required declaration above
              is recorded.
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={pins}
                onChange={(event) => {
                  setPins(event.target.checked);
                }}
              />
              Preserve existing Keep, pins and the approved household monitoring
              policy. This grants no new personal request.
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={history}
                onChange={(event) => {
                  setHistory(event.target.checked);
                }}
              />
              I accept that files cannot prove lost request history. Normal
              fresh watch checks, warnings and grace still apply.
            </label>
          </fieldset>
          {!complete && (
            <p>
              Every applicable person must declare before release. Independent
              people must use their own session.
            </p>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={disabled || !baseline || !pins || !history}
          >
            Release this edition’s history hold
          </button>
        </form>
      )}
    </section>
  );
}
