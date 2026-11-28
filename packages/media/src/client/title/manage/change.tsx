import { useRef, useState } from "react";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { useTargetCommand } from "#client/target-controls/mutation.ts";
import { Button } from "#client/ui/button.tsx";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { ProfileForm } from "./profile-form.tsx";

type Removal = NonNullable<MediaDetail["removalConfirmation"]>;

/** What a command that was accepted says in words. */
function outcome(status: string | undefined): string {
  return status === "completed" ? "Saved" : "Action queued";
}

function RetryAcquisition({
  user,
  context,
}: {
  user: MediaUser;
  context: DefaultTargetView;
}) {
  const retry = useTargetCommand(user.id);
  return (
    <DataRow
      title="Retry acquisition"
      detail="Tries to acquire this title again. It is offered while the title is not available."
      note={retry.isSuccess ? outcome(retry.data.result.status) : null}
      actions={
        <Button
          busy={retry.isPending}
          disabled={retry.isSuccess || commandNeedsReview(retry.error)}
          onClick={() => {
            retry.submit({ context, command: { action: "retry" } });
          }}
        >
          {retry.isPending ? "Saving…" : "Retry acquisition"}
        </Button>
      }
    >
      <CommandError
        error={retry.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
    </DataRow>
  );
}

function RemoveFromLibrary({
  user,
  media,
  context,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
}) {
  const remove = useTargetCommand(user.id);
  const dialog = useRef<HTMLDialogElement>(null);
  // What the owner was shown when they asked: the removal confirms exactly
  // these titles, even if the title is read again while the dialog is open.
  const [review, setReview] = useState<{
    context: DefaultTargetView;
    confirmation: Removal;
  } | null>(null);
  const { removalConfirmation } = media;
  return (
    <DataRow
      title="Remove from library"
      detail={
        <>
          <p>
            Queues an intentional removal and stops acquisition and upgrade
            monitoring. The file remains recoverable during quarantine.
          </p>
          {removalConfirmation === undefined && (
            <p>
              Removal details are unavailable. Refresh this title before
              confirming removal.
            </p>
          )}
        </>
      }
      note={remove.isSuccess ? outcome(remove.data.result.status) : null}
      actions={
        <Button
          variant="danger"
          busy={remove.isPending}
          disabled={
            removalConfirmation === undefined ||
            remove.isSuccess ||
            commandNeedsReview(remove.error)
          }
          onClick={() => {
            if (removalConfirmation === undefined) return;
            setReview({ context, confirmation: removalConfirmation });
            dialog.current?.showModal();
          }}
        >
          {remove.isPending ? "Saving…" : "Remove from library"}
        </Button>
      }
    >
      <CommandError
        error={remove.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      <ConfirmDialog
        ref={dialog}
        title="Remove from library?"
        confirmLabel="Remove from library"
        danger
        onConfirm={() => {
          if (review !== null)
            remove.submit({
              context: review.context,
              command: { action: "remove", confirmation: review.confirmation },
            });
          setReview(null);
        }}
        onCancel={() => {
          setReview(null);
        }}
      >
        <p>
          These titles share the affected files. Removing from the library
          removes all of them:
        </p>
        <ul>
          {review?.confirmation.media.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ul>
        <p>
          Acquisition and upgrade monitoring stop, and the files stay
          recoverable during quarantine.
        </p>
      </ConfirmDialog>
    </DataRow>
  );
}

/**
 * What the owner can do about how a title is acquired and kept: try again,
 * remove it, change the quality profile it is judged by. A film's other
 * changes are made one edition at a time, under Change an edition.
 */
export function ChangePanel({
  user,
  media,
  context,
  id,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
  id: string;
}) {
  const movie = media.kind === "movie";
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Panel
      title="Change how it is acquired or kept"
      id={id}
      description={
        movie
          ? "The quality profile applies to the whole film. Retry, keep and remove are per edition, below."
          : undefined
      }
    >
      {!movie && (
        <DataList label="Actions on this title">
          {media.availability !== "available" && (
            <RetryAcquisition
              key={`retry:${media.id}`}
              user={user}
              context={context}
            />
          )}
          {media.availability === "available" && (
            <RemoveFromLibrary
              key={`remove:${media.id}`}
              user={user}
              media={media}
              context={context}
            />
          )}
        </DataList>
      )}
      <ProfileForm
        // A saved profile comes back with a new version; start the form again.
        key={media.version}
        user={user}
        mediaId={media.id}
        kind={movie ? "movie" : "series"}
        version={media.version}
        currentId={media.intent?.profileId ?? null}
        saved={saved}
        onSaved={setSaved}
        onEdit={() => {
          setSaved(null);
        }}
      />
    </Panel>
  );
}
