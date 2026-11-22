import { useId, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import { isRecoveryScopeV2, type RecoveryDetail } from "#shared/recovery.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { dateLabel } from "#client/components.tsx";
import { queryClient, writeApi } from "#client/api.ts";
import {
  blockerSentence,
  DECLARATION_COPY,
  isWaitingState,
} from "#client/presentation/recovery.ts";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
} from "#client/ui/panel.tsx";
import { Before, Plain, TechnicalDetails } from "./parts.tsx";

const PersonalHold = z.object({
  userId: z.string(),
  mediaId: z.string(),
  isPin: z.boolean(),
  until: z.string().nullable(),
});

/** What has to be preserved, as rows: who, what, and why nothing is asked of them. */
function preservedRows(review: RecoveryDetail) {
  const nameOf = (id: string) =>
    review.scope.users.find((person) => person.id === id)?.displayName ??
    review.scope.excludedUsers.find((person) => person.id === id)
      ?.displayName ??
    "Household profile";
  const titleOf = (id: string) =>
    review.scope.media.find((item) => item.id === id)?.title;
  const pairs = isRecoveryScopeV2(review.scope)
    ? review.scope.excludedPairs.map((pair) => ({
        key: `pair:${pair.userId}:${pair.mediaId}`,
        title: `${nameOf(pair.userId)}, ${titleOf(pair.mediaId) ?? "a title"}`,
        detail:
          "No declaration required for this pair after fresh denial with no relevant historical claim.",
      }))
    : [];
  const excluded = review.scope.excludedUsers.map((person) => ({
    key: `user:${person.id}`,
    title: person.displayName,
    detail:
      "No response required because freshly verified library access denies these titles and no relevant request or hold is recorded.",
  }));
  const holds = review.scope.personalHolds.map((raw) => {
    const hold = PersonalHold.parse(raw);
    return {
      key: `hold:${hold.userId}:${hold.mediaId}`,
      title: `${nameOf(hold.userId)}, ${titleOf(hold.mediaId) ?? "a title"}`,
      detail: hold.isPin
        ? "Pinned. Stays pinned."
        : `Keep until ${hold.until === null ? "unbounded" : new Date(hold.until).toLocaleDateString()}. Stays kept.`,
    };
  });
  return [...holds, ...pairs, ...excluded];
}

/**
 * The owner's half of a household review: who has declared, what stays as it
 * is, and the one action that applies the declarations and releases the
 * holds. It asks twice, with the three statements and then a dialog that
 * names the titles, because nothing here can be taken back.
 */
export function ReleasePanel({
  user,
  review,
}: {
  user: MediaUser;
  review: RecoveryDetail;
}) {
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
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
          confirmHouseholdBaseline: true,
          confirmExistingPins: true,
          acknowledgeMissingHistory: true,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  const waiting = isWaitingState(review.state);
  const missing = review.scope.users.filter((person) =>
    review.missingUserIds.includes(person.id),
  );
  const blockers = review.scope.blockers;
  const ready = waiting && missing.length === 0 && blockers.length === 0;
  const preserved = preservedRows(review);
  const declared = review.responses.length;
  const titles = review.scope.media;
  return (
    <Panel
      title="Apply the review"
      titleId={headingId}
      description="Independent accounts respond for themselves. You may declare for an exact verified managed profile. Each person responds only for their scoped titles; unknown identities or access remain protected."
    >
      <h3>Who has declared</h3>
      <DataList label="Household declarations">
        {review.scope.users.map((person) => {
          const response = review.responses.find(
            (row) => row.userId === person.id,
          );
          const recordedBy =
            response === undefined
              ? undefined
              : (review.scope.users.find(
                  (actor) => actor.id === response.actorId,
                )?.displayName ?? "verified review actor");
          return (
            <DataRow
              key={person.id}
              title={person.displayName}
              status={
                review.missingUserIds.includes(person.id) ? (
                  <Badge tone="warn">Awaiting an explicit response</Badge>
                ) : (
                  <Badge tone="ok">Declaration recorded</Badge>
                )
              }
              detail={
                <>
                  {"declarationAuthority" in person &&
                  person.declarationAuthority === "managed_owner" ? (
                    <p>Managed profile; owner declaration.</p>
                  ) : (
                    <p>Declares for themselves.</p>
                  )}
                  {recordedBy !== undefined && <p>Recorded by {recordedBy}.</p>}
                  {response?.response.declarations.map((declaration) => (
                    <p key={declaration.mediaId}>
                      {
                        review.scope.media.find(
                          (media) => media.id === declaration.mediaId,
                        )?.title
                      }
                      : {DECLARATION_COPY[declaration.intent].option}
                    </p>
                  ))}
                </>
              }
            />
          );
        })}
      </DataList>

      <h3>Keep and pins to preserve</h3>
      {preserved.length === 0 ? (
        <EmptyNote>
          No personal Keep or pins are recorded in this snapshot.
        </EmptyNote>
      ) : preserved.length <= 6 ? (
        <DataList label="Keep and pins to preserve">
          {preserved.map((row) => (
            <DataRow key={row.key} title={row.title} detail={row.detail} />
          ))}
        </DataList>
      ) : (
        <DisclosureList>
          <Disclosure
            title={`${String(preserved.length)} records stay as they are`}
          >
            <DataList label="Keep and pins to preserve">
              {preserved.map((row) => (
                <DataRow key={row.key} title={row.title} detail={row.detail} />
              ))}
            </DataList>
          </Disclosure>
        </DisclosureList>
      )}

      <h3>Apply</h3>
      {review.receiptId !== null && (
        <Callout tone="ok" title="This review was applied">
          Its declarations were applied and only the listed holds were released.
        </Callout>
      )}
      {apply.isSuccess && (
        <Callout tone="ok" title="Review applied">
          {declared} {declared === 1 ? "declaration was" : "declarations were"}{" "}
          applied and the recovery hold on {titles.length}{" "}
          {titles.length === 1 ? "title was" : "titles were"} released. Existing
          pins, fresh watch checks and normal warning and grace rules still
          apply.
        </Callout>
      )}
      {!ready && waiting && (
        <Callout tone="warn" title="Not ready to apply">
          <ul>
            {missing.map((person) => (
              <li key={person.id}>
                {person.displayName} has not declared yet.
              </li>
            ))}
            {blockers.map((blocker) => (
              <li key={blocker}>{blockerSentence(blocker)}</li>
            ))}
          </ul>
        </Callout>
      )}
      {ready && (
        <>
          <Form
            labelledBy={headingId}
            onSubmit={() => {
              dialog.current?.showModal();
            }}
          >
            <CheckboxField
              name="baseline"
              required
              requiredMessage="Confirm that everyone in the household is represented."
              label="I confirm everyone in this household is represented and these explicit responses define our present intent."
            />
            <CheckboxField
              name="pins"
              required
              requiredMessage="Confirm you reviewed the existing Keep and pins."
              label="I reviewed the existing Keep and pins; they must remain unchanged except for requested Keep extensions."
            />
            <CheckboxField
              name="history"
              required
              requiredMessage="Confirm you accept that lost request history cannot be recovered."
              label="Lost request history cannot be recovered from file checksums. I accept this newly declared household baseline for only these titles."
            />
            <Before>
              Applying records{" "}
              <strong>
                {declared} {declared === 1 ? "declaration" : "declarations"}
              </strong>{" "}
              and releases the recovery hold on{" "}
              <strong>
                {titles.length} {titles.length === 1 ? "title" : "titles"}
              </strong>
              . Plex access is checked again when you apply, and the release is
              refused if anything changed since this review was captured. A
              later change needs a new review.
            </Before>
            <FormFooter
              submitLabel="Apply declarations and release reviewed holds"
              pendingLabel="Applying review"
              pending={apply.isPending}
              error={apply.error}
            />
          </Form>
          <ConfirmDialog
            ref={dialog}
            title="Apply this review and release the holds?"
            confirmLabel="Apply declarations and release reviewed holds"
            onConfirm={() => {
              apply.mutate();
            }}
          >
            <p>
              This records {declared}{" "}
              {declared === 1 ? "declaration" : "declarations"} and releases the
              recovery hold on:
            </p>
            <ul>
              {titles.map((media) => (
                <li key={media.id}>{media.title}</li>
              ))}
            </ul>
            <p>
              It is written into an immutable receipt. Existing pins and Keep
              stay.
            </p>
          </ConfirmDialog>
        </>
      )}
      {apply.error !== null && !ready && (
        <Callout tone="danger" title="The review was not applied">
          {apply.error.message}
        </Callout>
      )}
      <Plain>Review expires {dateLabel(review.expiresAt)}.</Plain>
      <TechnicalDetails
        rows={[
          ["Review", review.id],
          ["Version", String(review.version)],
          ["Scope hash", review.scopeHash],
          ["Response hash", review.responseHash ?? "none yet"],
          ["Recovery epoch", String(review.scope.recoveryEpoch)],
          ["Runtime version", String(review.scope.runtimeVersion)],
          ["Receipt", review.receiptId ?? "none"],
        ]}
      />
    </Panel>
  );
}
