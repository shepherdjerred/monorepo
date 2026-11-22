import { useRef, useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import { MovieHistoryPrepareV3 } from "#client/movie-history/prepare.tsx";
import { StatusBadge } from "#client/status/badge.tsx";
import { CommandError } from "#client/target-controls/errors.tsx";
import { Button, ButtonRow } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { FactList } from "#client/ui/record.tsx";
import { MovieEditionSelector } from "./selector.tsx";
import { movieAdmissionReasonV4 } from "./presentation-v4.ts";
import {
  invalidateMovieTargetV4,
  useMovieLifecycleCommandV4,
  useMovieTargetV4,
  type MovieLifecycleControllerV4,
} from "./target-api-v4.ts";
import { MovieReleaseCandidatesV4 } from "./target-releases-v4.tsx";
import { MovieEditionFilesV4 } from "./target-files-v4.tsx";
import { MovieEditionProgressV4 } from "./target-progress-v4.tsx";
import { MovieCaptionReplacementV2 } from "./subtitle-replacement-v2.tsx";
import { MovieRollbackControlV1 } from "./rollback.tsx";
import styles from "./edition.module.css";

const cx = classNames(styles);

/**
 * Looking at and changing one edition of a film: which file it has, how its
 * download is going, and what the owner may do to it. An edition is a named
 * cut of the film; each is read and changed on its own.
 */
export function MovieEditionControlsV4({
  user,
  mediaId,
  id,
}: {
  user: MediaUser;
  mediaId: string;
  id?: string;
}) {
  const [edition, setEdition] = useState<MovieEditionKey | "">("");
  const target = useMovieTargetV4(mediaId, edition);
  const action = useMovieLifecycleCommandV4(user.id);
  return (
    <Panel
      title="Change an edition"
      description="Choose an edition to see its file and its download, and to keep, restore, retry or remove it, or to choose its release."
      {...(id === undefined ? {} : { id })}
    >
      <MovieEditionSelector
        value={edition}
        change={setEdition}
        disabled={action.isPending || action.unresolved !== null}
      />
      {edition !== "" && target.isPending && (
        <SkeletonRows label="Loading the edition" rows={2} />
      )}
      {target.error !== null && (
        <LoadError
          what="This edition"
          error={target.error}
          retry={() => {
            void target.refetch();
          }}
        />
      )}
      {target.data !== undefined && (
        <MovieEditionTargetV4
          key={edition}
          user={user}
          context={target.data}
          action={action}
        />
      )}
      <CommandError
        error={action.error}
        review={() => {
          action.reset();
          void invalidateMovieTargetV4(mediaId);
        }}
      />
      {action.unresolved !== null && (
        <Callout
          tone="warn"
          title="The result of your last action is unknown"
          action={
            <div>
              <Button
                disabled={action.isPending}
                onClick={action.retryOriginal}
              >
                Retry original action
              </Button>
            </div>
          }
        >
          Retry that same action before choosing another.
        </Callout>
      )}
      {action.isSuccess && (
        <Callout
          tone="ok"
          action={
            <div>
              <Button
                onClick={() => {
                  action.reset();
                  void invalidateMovieTargetV4(mediaId);
                }}
              >
                Refresh edition
              </Button>
            </div>
          }
        >
          Edition action accepted. Refresh the edition to review another action.
        </Callout>
      )}
    </Panel>
  );
}

function MovieEditionTargetV4({
  user,
  context,
  action,
}: {
  user: MediaUser;
  context: MovieTargetContextV4;
  action: MovieLifecycleControllerV4;
}) {
  if (context.access === "protection_only")
    return (
      <>
        <Callout tone="neutral">
          Library details are unavailable. You can still protect your existing
          edition request.
        </Callout>
        <MovieProtectiveControlsV4 context={context} action={action} />
      </>
    );
  return (
    <div className={cx("edition")}>
      <header className={cx("editionHead")}>
        <h3 className={cx("editionTitle")}>{context.editionLabel}</h3>
        <StatusBadge value={context.target.availability} />
      </header>
      <FactList
        facts={[
          {
            term: "Upgrade monitoring",
            detail: context.target.monitoring ? "Active" : "Paused",
          },
          {
            term: "Library policy",
            detail: context.target.libraryMonitoring
              ? "Monitored"
              : "Personal requests only",
          },
        ]}
      />
      {context.reasons.length > 0 && (
        <Callout tone="neutral">
          <ul>
            {context.reasons.map((reason) => (
              <li key={reason}>{movieAdmissionReasonV4(reason)}</li>
            ))}
          </ul>
        </Callout>
      )}
      <MovieEditionFilesV4 context={context} />
      <MovieEditionProgressV4 context={context} />
      <h4 className={cx("subhead")}>What you can do with this edition</h4>
      <MovieProtectiveControlsV4 context={context} action={action} />
      {(context.allowedActions.includes("restore") ||
        context.allowedActions.includes("retry")) && (
        <ButtonRow>
          {context.allowedActions.includes("restore") && (
            <Button
              disabled={action.blocked}
              onClick={() => {
                action.submit(context, { action: "restore" });
              }}
            >
              Restore this edition
            </Button>
          )}
          {context.allowedActions.includes("retry") && (
            <Button
              disabled={action.blocked || user.restricted}
              onClick={() => {
                action.submit(context, { action: "retry" });
              }}
            >
              Retry this edition
            </Button>
          )}
        </ButtonRow>
      )}
      {context.allowedActions.includes("select_release") && (
        <MovieReleaseCandidatesV4
          context={context}
          action={action}
          disabled={user.restricted}
        />
      )}
      <MovieCaptionReplacementV2 user={user} context={context} />
      <MovieRollbackControlV1 user={user} scope={context.scope} />
      {user.role === "owner" && context.reasons.includes("recovery_hold") && (
        <MovieHistoryPrepareV3 user={user} scope={context.scope} />
      )}
      {context.allowedActions.includes("remove") && (
        <MovieRemovalV4 context={context} action={action} />
      )}
    </div>
  );
}

function MovieProtectiveControlsV4({
  context,
  action,
}: {
  context: MovieTargetContextV4;
  action: MovieLifecycleControllerV4;
}) {
  const buttons = [
    "keep",
    context.ownHold?.isPin === true ? "unpin" : "pin",
  ] as const;
  const offered = buttons.filter((name) =>
    context.allowedProtectiveActions.includes(name),
  );
  return (
    <>
      {offered.length > 0 && (
        <ButtonRow>
          {offered.map((name) => (
            <Button
              key={name}
              disabled={action.blocked}
              onClick={() => {
                action.submit(context, { action: name });
              }}
            >
              {humanize(name)} this edition
            </Button>
          ))}
        </ButtonRow>
      )}
      {context.ownHold !== null && (
        <p className={cx("muted")}>
          {context.ownHold.isPin
            ? "Your edition is pinned indefinitely."
            : `Your edition is protected until ${dateLabel(context.ownHold.until)}.`}
        </p>
      )}
    </>
  );
}

function MovieRemovalV4({
  context,
  action,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
  action: MovieLifecycleControllerV4;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // What the owner was shown when they asked. The removal confirms exactly
  // that, even if the edition is read again while the dialog is open.
  const [review, setReview] = useState<typeof context | null>(null);
  return (
    <div className={cx("removal")}>
      <h4 className={cx("subhead")}>Remove this edition from the library</h4>
      <p className={cx("muted")}>
        This moves the selected edition and its owned captions to recoverable
        quarantine and stops its acquisition and upgrade monitoring.
      </p>
      <div>
        <Button
          variant="danger"
          disabled={action.blocked || context.removalConfirmation === null}
          onClick={() => {
            setReview(context);
            dialog.current?.showModal();
          }}
        >
          Remove this edition
        </Button>
      </div>
      {context.removalConfirmation === null && (
        <p className={cx("muted")}>
          Removal cannot be confirmed from the details just read. Refresh the
          edition first.
        </p>
      )}
      <ConfirmDialog
        ref={dialog}
        title="Remove this edition from the library?"
        confirmLabel="Remove this edition"
        danger
        onConfirm={() => {
          if (review?.removalConfirmation != null)
            action.submit(review, {
              action: "remove",
              confirmation: review.removalConfirmation,
            });
          setReview(null);
        }}
        onCancel={() => {
          setReview(null);
        }}
      >
        <p>
          Confirm removal of {review?.title}, {review?.editionLabel}. Its file
          and owned captions move to recoverable quarantine, and Media stops
          acquiring and upgrading it.
        </p>
      </ConfirmDialog>
    </div>
  );
}
