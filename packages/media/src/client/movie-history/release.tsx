import { useId, useRef } from "react";
import type { MediaUser } from "#shared/contract.ts";
import { ReleaseMovieHistoryV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { blockerSentence } from "#client/presentation/recovery.ts";
import { Before, Plain, TechnicalDetails } from "#client/recovery/parts.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Panel } from "#client/ui/panel.tsx";
import type {
  MovieHistoryOwnerReviewV3,
  MovieHistoryWriteControllerV3,
} from "./api.ts";
import { INTENT_COPY } from "./intents.ts";
import styles from "./movie-history.module.css";

const cx = classNames(styles);

/** Who the review waits for, and who has said what. */
function Declarations({ review }: { review: MovieHistoryOwnerReviewV3 }) {
  return (
    <DataList label="Household declarations">
      {review.scope.users.map((subject) => {
        const response = review.responses.find(
          (row) => row.userId === subject.id,
        );
        return (
          <DataRow
            key={subject.id}
            title={subject.displayName}
            detail={
              subject.declarationAuthority === "managed_owner"
                ? "Managed Home profile. You declare for them."
                : "Declares for themselves."
            }
            status={
              response === undefined ? (
                <Badge tone="warn">Declaration needed</Badge>
              ) : (
                <Badge tone="ok">
                  {INTENT_COPY[response.response.declaration.intent].option}
                </Badge>
              )
            }
          />
        );
      })}
    </DataList>
  );
}

/** What stops the release, as a list, or nothing when nothing does. */
function Obstacles({
  review,
  closed,
}: {
  review: MovieHistoryOwnerReviewV3;
  closed: boolean;
}) {
  const blockers = review.scope.blockers;
  const missing = review.missingUserIds.length;
  if (!closed && missing === 0 && blockers.length === 0) return null;
  return (
    <Callout tone="warn" title="Not ready to release">
      <ul className={cx("facts")}>
        {closed && (
          <li>
            This review is closed or expired. It cannot accept new declarations
            or release authority.
          </li>
        )}
        {missing > 0 && (
          <li>
            Every applicable person must declare before release. Independent
            people must use their own session.
          </li>
        )}
        {blockers.map((blocker) => (
          <li key={blocker}>{blockerSentence(blocker)}</li>
        ))}
        {blockers.length > 0 && (
          <li>
            This capture has unresolved protection. Review the current edition
            and prepare a fresh capture when those facts have been resolved.
          </li>
        )}
      </ul>
    </Callout>
  );
}

function ReleaseForm({
  user,
  review,
  command,
  headingId,
}: {
  user: MediaUser;
  review: MovieHistoryOwnerReviewV3;
  command: MovieHistoryWriteControllerV3;
  headingId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const release = () => {
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
  };
  return (
    <>
      <Form
        labelledBy={headingId}
        onSubmit={() => {
          dialog.current?.showModal();
        }}
      >
        <fieldset disabled={command.blocked} className={cx("group")}>
          <CheckboxField
            name="baseline"
            required
            requiredMessage="Confirm that everyone applicable has declared."
            label="Everyone applicable is listed and every required declaration above is recorded."
          />
          <CheckboxField
            name="pins"
            required
            requiredMessage="Confirm that existing Keep and pins stay."
            label="Preserve existing Keep, pins and the approved household monitoring policy. This grants no new personal request."
          />
          <CheckboxField
            name="history"
            required
            requiredMessage="Confirm you accept that lost request history cannot be proven."
            label="I accept that files cannot prove lost request history. Normal fresh watch checks, warnings and grace still apply."
          />
          <Before>
            Releasing lifts the household history hold on this edition only.
            Existing Keep, pins and household monitoring stay, and normal watch
            checks, warnings and grace still apply. A later change needs a fresh
            review.
          </Before>
          <FormFooter
            submitLabel="Release this edition’s history hold"
            pendingLabel="Releasing history hold"
            pending={command.isPending}
          />
        </fieldset>
      </Form>
      <ConfirmDialog
        ref={dialog}
        title="Release this edition’s history hold?"
        confirmLabel="Release this edition’s history hold"
        onConfirm={release}
      >
        <p>
          This releases the household history hold on{" "}
          <strong>{review.scope.media.title}</strong> only, and writes it into
          an immutable receipt.
        </p>
      </ConfirmDialog>
    </>
  );
}

/**
 * The owner's half of an edition review: who has declared, what stops the
 * release, and the one action that lifts this edition's history hold. It asks
 * with three statements and then a dialog, because the release is recorded in
 * an immutable receipt.
 */
export function MovieHistoryReleaseV3({
  user,
  review,
  command,
  closed,
  technical,
}: {
  user: MediaUser;
  review: MovieHistoryOwnerReviewV3;
  command: MovieHistoryWriteControllerV3;
  closed: boolean;
  /** The raw identifiers and hashes, for the owner to copy. */
  technical: readonly (readonly [label: string, value: string])[];
}) {
  const headingId = useId();
  const released = review.receiptId !== null;
  const ready =
    !released &&
    !closed &&
    review.missingUserIds.length === 0 &&
    review.scope.blockers.length === 0;
  return (
    <Panel
      title="Household declarations"
      titleId={headingId}
      description="Who still has to say what they want for this edition, and the one step that lifts its history hold once they all have."
    >
      <Declarations review={review} />
      {released && (
        <Callout tone="ok" title="This edition’s history hold was released">
          Existing pins, Keep, household monitoring and normal watch, warning
          and grace requirements remain effective.
        </Callout>
      )}
      {!released && <Obstacles review={review} closed={closed} />}
      {ready && (
        <ReleaseForm
          user={user}
          review={review}
          command={command}
          headingId={headingId}
        />
      )}
      {!released && !ready && (
        <Plain>
          The release is offered here once everyone has declared and nothing
          blocks it.
        </Plain>
      )}
      <TechnicalDetails rows={technical} />
    </Panel>
  );
}
