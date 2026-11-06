import { useState } from "react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieHistoryDeclarationV3 } from "#shared/movie-editions/history-review-v3.ts";
import { dateLabel, ErrorNotice, humanize } from "#client/components.tsx";
import type { MovieHistoryWriteControllerV3 } from "./api.ts";
import {
  movieHistoryCurrentChoiceV3,
  movieHistoryResponseV3,
  type MovieHistoryDeclarationContextV3,
} from "./declaration.ts";

export function MovieHistoryResponseFormV3({
  user,
  person,
  command,
  closed,
}: {
  user: MediaUser;
  person: MovieHistoryDeclarationContextV3;
  command: MovieHistoryWriteControllerV3;
  closed: boolean;
}) {
  const [intent, setIntent] = useState<
    MovieHistoryDeclarationV3["intent"] | ""
  >("");
  const [keepId, setKeepId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const currentChoice = movieHistoryCurrentChoiceV3(person);
  const activeRequest = person.requests.some(
    (row) => row.active && !row.excluded,
  );
  const keeps = person.personalHolds.filter(
    (hold) =>
      hold.isPin ||
      (hold.until !== null && Date.parse(hold.until) > Date.now()),
  );
  const response = person.response;
  const recorded = response !== null;
  const proxy = person.subject.id !== user.id;
  const disabled = command.blocked || closed || recorded;
  return (
    <section className="panel">
      <h2>
        {proxy
          ? `Owner declaration for ${person.subject.displayName}`
          : "Your declaration"}
      </h2>
      {proxy && (
        <p>
          This is the captured managed Home profile. Independent household
          members must declare for themselves.
        </p>
      )}
      {response !== null && (
        <p>
          Recorded: {humanize(response.declaration.intent)}. This declaration is
          immutable; a change needs a fresh review.
        </p>
      )}
      {response === null && (
        <>
          {currentChoice === null ? (
            <p>
              No explicit current choice for this edition was captured. To
              request it, choose the edition on the movie page and ask the owner
              for a fresh review.
            </p>
          ) : (
            <p>
              This review contains your explicit edition choice and{" "}
              {currentChoice.subtitleLanguages.length === 0
                ? "no requested caption languages"
                : `requested captions: ${currentChoice.subtitleLanguages.join(", ")}`}
              .
            </p>
          )}
          {activeRequest && (
            <p>
              To declare that you no longer request this edition, cancel the
              actual request first and ask the owner to capture a fresh review.
              This form cannot cancel a request.
            </p>
          )}
          <p>
            <Link to={`/media/${encodeURIComponent(person.scope.mediaId)}`}>
              Review this movie’s edition choices and Keep
            </Link>
          </p>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled || !acknowledged || intent === "") return;
              try {
                const body = movieHistoryResponseV3(person, intent, keepId);
                setError(null);
                command.submit({
                  actorId: user.id,
                  path: `/movie-history/reviews/${encodeURIComponent(person.id)}/responses`,
                  body,
                });
              } catch (error_) {
                if (!(error_ instanceof Error)) throw error_;
                setError(error_);
              }
            }}
          >
            <fieldset disabled={disabled}>
              <legend>
                {proxy
                  ? `${person.subject.displayName}’s present intent`
                  : "Your present intent for this edition"}
              </legend>
              <label>
                Declaration
                <select
                  required
                  value={intent}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value !== "" &&
                      value !== "request" &&
                      value !== "keep" &&
                      value !== "no_longer_request"
                    )
                      throw new Error("Unknown history declaration");
                    setIntent(value);
                    setAcknowledged(false);
                  }}
                >
                  <option value="">Choose a declaration</option>
                  <option value="request" disabled={currentChoice === null}>
                    I request this edition using my captured choice
                  </option>
                  <option
                    value="keep"
                    disabled={currentChoice === null || keeps.length === 0}
                  >
                    Keep this edition using my captured choice and hold
                  </option>
                  <option value="no_longer_request" disabled={activeRequest}>
                    I no longer request this edition
                  </option>
                </select>
              </label>
              {intent === "keep" && (
                <label>
                  Captured Keep or pin
                  <select
                    required
                    value={keepId}
                    onChange={(event) => {
                      setKeepId(event.target.value);
                      setAcknowledged(false);
                    }}
                  >
                    <option value="">Choose your captured hold</option>
                    {keeps.map((hold) => (
                      <option key={hold.id} value={hold.id}>
                        {hold.isPin
                          ? "Pinned"
                          : `Keep until ${dateLabel(hold.until)}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                />
                I declare the visible edition and captured choice, acknowledge{" "}
                {person.subject.claimAcknowledgements.length} selected imported
                request claim
                {person.subject.claimAcknowledgements.length === 1 ? "" : "s"},
                and understand that lost request history cannot be reconstructed
                from files.
              </label>
            </fieldset>
            <button
              className="button"
              type="submit"
              disabled={
                disabled ||
                !acknowledged ||
                intent === "" ||
                (intent === "keep" && keepId === "")
              }
            >
              Record {proxy ? `${person.subject.displayName}’s` : "my"}{" "}
              declaration
            </button>
            {error !== null && <ErrorNotice error={error} />}
          </form>
        </>
      )}
    </section>
  );
}
