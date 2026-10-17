import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { RecoveryDetail } from "#shared/recovery.ts";
import { isRecoveryScopeV2, respondentMediaIds } from "#shared/recovery.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi, queryClient } from "#client/api.ts";
import { ErrorNotice, Notice, humanize } from "#client/components.tsx";

export function RecoveryResponseForm({
  user,
  review,
}: {
  user: MediaUser;
  review: RecoveryDetail;
}) {
  const subjects = review.scope.users.filter(
    (person) =>
      person.id === user.id ||
      (user.role === "owner" &&
        !user.restricted &&
        "declarationAuthority" in person &&
        person.declarationAuthority === "managed_owner"),
  );
  return (
    <>
      {subjects.map((subject) => (
        <SubjectResponseForm
          key={`${review.id}:${subject.id}`}
          user={user}
          review={review}
          subjectId={subject.id}
        />
      ))}
    </>
  );
}

function SubjectResponseForm({
  user,
  review,
  subjectId,
}: {
  user: MediaUser;
  review: RecoveryDetail;
  subjectId: string;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const subject = review.scope.users.find((person) => person.id === subjectId);
  const applicable = respondentMediaIds(review.scope, subjectId);
  const selectedMedia = review.scope.media.filter((item) =>
    applicable.includes(item.id),
  );
  const proxy = subjectId !== user.id;
  const acknowledgements = isRecoveryScopeV2(review.scope)
    ? (review.scope.users.find((person) => person.id === subjectId)
        ?.claimAcknowledgements ?? [])
    : [];
  const previous = review.responses.find((row) => row.userId === subjectId);
  const submit = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/recovery/reviews/${review.id}/responses`,
        schema: CommandResultSchema,
        body: {
          scopeHash: review.scopeHash,
          ...(isRecoveryScopeV2(review.scope)
            ? {
                subjectUserId: subjectId,
                claimAcknowledgements: acknowledgements,
              }
            : {}),
          acknowledgePending: pending,
          declarations: selectedMedia.map((media) => ({
            mediaId: media.id,
            intent: choices[media.id],
            ...(choices[media.id] === "keep" ? { days: 30 } : {}),
          })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  return (
    <section className="panel stack-form">
      <h2>
        {proxy
          ? `Declare for ${subject?.displayName ?? "managed profile"}`
          : "Your present intent"}
      </h2>
      {proxy && (
        <p>
          You are declaring as the owner for this exact managed Plex profile.
          The record keeps you as the actor and {subject?.displayName} as the
          requester. Independent accounts must respond themselves.
        </p>
      )}
      <p>
        This declaration covers only the {selectedMedia.length} listed titles.
        Other episodes, series subscriptions and existing pins remain unchanged.
      </p>
      {acknowledgements.length > 0 && (
        <p>
          {acknowledgements.length} exact legacy request records are associated
          with this person and these titles. Your declaration accounts for this
          selected scope only; unselected history remains protected.
        </p>
      )}
      {previous === undefined ? (
        <>
          {selectedMedia.map((media) => (
            <label className="field" key={media.id}>
              {media.title}
              <select
                value={choices[media.id] ?? ""}
                onChange={(event) => {
                  setChoices({ ...choices, [media.id]: event.target.value });
                }}
                disabled={review.state === "released"}
              >
                <option value="">Choose explicitly</option>
                <option value="request">Retain / request</option>
                <option value="keep">Keep for 30 days after apply</option>
                <option value="no_longer_request">No longer requested</option>
              </select>
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={pending}
              onChange={(event) => {
                setPending(event.target.checked);
              }}
            />
            I understand these declarations are pending, and do not replace an
            immediate Keep action. I reviewed the associated legacy records for
            this exact selected scope.
          </label>
          <button
            className="button"
            disabled={
              submit.isPending ||
              !pending ||
              review.state !== "awaiting_responses" ||
              review.scope.blockers.length > 0 ||
              selectedMedia.length === 0 ||
              selectedMedia.some((media) => (choices[media.id] ?? "") === "")
            }
            onClick={() => {
              submit.mutate();
            }}
          >
            {proxy
              ? "Record managed-profile declaration"
              : "Record my declaration"}
          </button>
        </>
      ) : (
        <Notice>
          This immutable declaration is{" "}
          {review.state === "released" ? "applied" : "pending owner review"}. To
          change it, ask the owner to prepare a new review.
          {previous.response.declarations.map((declaration) => (
            <p key={declaration.mediaId}>
              {
                review.scope.media.find(
                  (media) => media.id === declaration.mediaId,
                )?.title
              }
              : {humanize(declaration.intent)}
            </p>
          ))}
        </Notice>
      )}
      {submit.error !== null && <ErrorNotice error={submit.error} />}
    </section>
  );
}

const PersonalHold = z.object({
  userId: z.string(),
  mediaId: z.string(),
  isPin: z.boolean(),
  until: z.string().nullable(),
});
export function RecoveryReleaseForm({
  user,
  review,
}: {
  user: MediaUser;
  review: RecoveryDetail;
}) {
  const [baseline, setBaseline] = useState(false);
  const [pins, setPins] = useState(false);
  const [history, setHistory] = useState(false);
  const apply = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/recovery/reviews/${review.id}/release`,
        schema: CommandResultSchema,
        body: {
          expectedVersion: review.version,
          scopeHash: review.scopeHash,
          responseHash: review.responseHash,
          confirmHouseholdBaseline: baseline,
          confirmExistingPins: pins,
          acknowledgeMissingHistory: history,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  return (
    <section className="panel stack-form">
      <h2>Owner: household baseline</h2>
      <p>
        Independent accounts respond for themselves. The current owner may
        declare for an exact verified managed profile. Each person responds only
        for their scoped titles; unknown identities or access remain protected.
        Plex access must be freshly verified when you apply.
      </p>
      {review.scope.users.map((person) => (
        <p key={person.id}>
          <strong>{person.displayName}</strong> ·{" "}
          {review.missingUserIds.includes(person.id)
            ? "Awaiting an explicit response"
            : "Declaration recorded"}
          {"declarationAuthority" in person &&
            person.declarationAuthority === "managed_owner" &&
            " · Managed profile; owner declaration"}
          {review.responses.find((row) => row.userId === person.id)?.actorId !==
            undefined && (
            <span>
              {" "}
              · Recorded by{" "}
              {review.scope.users.find(
                (actor) =>
                  actor.id ===
                  review.responses.find((row) => row.userId === person.id)
                    ?.actorId,
              )?.displayName ?? "verified review actor"}
            </span>
          )}
          {review.responses
            .find((row) => row.userId === person.id)
            ?.response.declarations.map((declaration) => (
              <span key={declaration.mediaId}>
                {" "}
                ·{" "}
                {
                  review.scope.media.find(
                    (media) => media.id === declaration.mediaId,
                  )?.title
                }
                : {humanize(declaration.intent)}
              </span>
            ))}
        </p>
      ))}
      <h3>Keep and pins to preserve</h3>
      {isRecoveryScopeV2(review.scope) &&
        review.scope.excludedPairs.map((pair) => (
          <p key={`${pair.userId}:${pair.mediaId}`}>
            {review.scope.users.find((person) => person.id === pair.userId)
              ?.displayName ??
              review.scope.excludedUsers.find(
                (person) => person.id === pair.userId,
              )?.displayName ??
              "Household profile"}{" "}
            ·{" "}
            {review.scope.media.find((item) => item.id === pair.mediaId)?.title}
            : no declaration required for this pair after fresh denial with no
            relevant historical claim.
          </p>
        ))}
      {review.scope.excludedUsers.map((person) => (
        <p key={person.id}>
          {person.displayName}: no response required because freshly verified
          library access denies these titles and no relevant request or hold is
          recorded.
        </p>
      ))}
      {review.scope.personalHolds.length === 0 && (
        <p>No personal Keep or pins are recorded in this snapshot.</p>
      )}
      {review.scope.personalHolds.map((raw) => {
        const hold = PersonalHold.parse(raw);
        return (
          <p key={`${hold.userId}:${hold.mediaId}`}>
            {
              review.scope.users.find((person) => person.id === hold.userId)
                ?.displayName
            }{" "}
            ·{" "}
            {
              review.scope.media.find((media) => media.id === hold.mediaId)
                ?.title
            }{" "}
            ·{" "}
            {hold.isPin
              ? "Pinned"
              : `Keep until ${hold.until === null ? "unbounded" : new Date(hold.until).toLocaleDateString()}`}
          </p>
        );
      })}
      <label className="check-label">
        <input
          type="checkbox"
          checked={baseline}
          onChange={(event) => {
            setBaseline(event.target.checked);
          }}
        />
        I confirm everyone in this household is represented and these explicit
        responses define our present intent.
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={pins}
          onChange={(event) => {
            setPins(event.target.checked);
          }}
        />
        I reviewed the existing Keep and pins; they must remain unchanged except
        for requested Keep extensions.
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={history}
          onChange={(event) => {
            setHistory(event.target.checked);
          }}
        />
        Lost request history cannot be recovered from file checksums. I accept
        this newly declared household baseline for only these titles.
      </label>
      <button
        className="button"
        disabled={
          apply.isPending ||
          !baseline ||
          !pins ||
          !history ||
          review.state !== "awaiting_responses" ||
          review.missingUserIds.length > 0 ||
          review.scope.blockers.length > 0
        }
        onClick={() => {
          apply.mutate();
        }}
      >
        Apply declarations and release reviewed holds
      </button>
      {apply.error !== null && <ErrorNotice error={apply.error} />}
    </section>
  );
}
