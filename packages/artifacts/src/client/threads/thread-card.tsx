import { CheckIcon, RotateCcwIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { REPLY_EVENT } from "./reply-event.ts";
import type {
  ThreadComment,
  ThreadView,
} from "@shepherdjerred/artifacts/procedures";
import {
  useDeleteComment,
  useEditComment,
  useRedeliver,
  useReply,
  useSetResolved,
} from "#client/data/mutations.ts";
import { deliveryChip, isEditable } from "#client/lib/delivery.ts";
import { formatAge } from "#client/lib/format.ts";
import { anchorLabel, isOtherVersion } from "#client/lib/pins.ts";
import { Composer } from "./composer.tsx";

/** Re-renders each second while `until` is in the future, so edit windows close on screen. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return running ? now : Date.now();
}

function CommentRow({
  comment,
  thread,
  currentVersion,
  now,
}: {
  readonly comment: ThreadComment;
  readonly thread: ThreadView;
  readonly currentVersion: number | null;
  readonly now: number;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const edit = useEditComment();
  const remove = useDeleteComment();
  const redeliver = useRedeliver();
  const chip = deliveryChip(comment, thread, currentVersion);
  const editable = isEditable(comment, now);
  const human = comment.author.kind === "human";

  return (
    <li className="ar-comment" data-author={comment.author.kind}>
      <div className="ar-comment-head">
        <strong>{comment.author.name}</strong>
        <time dateTime={comment.createdAt}>{formatAge(comment.createdAt)}</time>
        {human ? null : <span className="ar-tag">agent</span>}
      </div>
      {editing ? (
        <Composer
          label="Edit comment"
          submitLabel="Save"
          initial={comment.body}
          autoFocus
          pending={edit.isPending}
          onSubmit={(body) => {
            edit.mutate(
              { commentId: comment.id, body },
              {
                onSuccess: () => {
                  setEditing(false);
                },
              },
            );
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <p className="ar-comment-body">{comment.body}</p>
      )}
      {chip === null && !editable ? null : (
        <div className="ar-comment-foot">
          {chip === null ? null : (
            <span
              className="ar-chip"
              data-tone={chip.tone}
              data-testid="delivery-chip"
            >
              {chip.label}
            </span>
          )}
          {chip?.canRedeliver === true ? (
            <button
              type="button"
              className="ar-link-button"
              disabled={redeliver.isPending}
              onClick={() => {
                redeliver.mutate({ commentId: comment.id });
              }}
            >
              <SendIcon aria-hidden="true" />
              Redeliver
            </button>
          ) : null}
          {editable && !editing ? (
            <>
              <button
                type="button"
                className="ar-link-button"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="ar-link-button"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate({ commentId: comment.id });
                }}
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** A "Reply" link that opens the reply box; `R` on the selected thread opens it too. */
function ReplyBox({
  threadId,
  selected,
}: {
  readonly threadId: string;
  readonly selected: boolean;
}): React.JSX.Element {
  const reply = useReply();
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    const onReply = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail === threadId)
        setReplying(true);
    };
    document.addEventListener(REPLY_EVENT, onReply);
    return () => {
      document.removeEventListener(REPLY_EVENT, onReply);
    };
  }, [threadId]);

  if (!replying)
    return (
      <button
        type="button"
        className="ar-reply-toggle"
        aria-keyshortcuts={selected ? "R" : undefined}
        onClick={() => {
          setReplying(true);
        }}
      >
        Reply
      </button>
    );
  return (
    <Composer
      label="Reply"
      submitLabel="Send reply"
      textareaId={`reply-${threadId}`}
      autoFocus
      pending={reply.isPending}
      onSubmit={(body) => {
        reply.mutate(
          { threadId, body },
          {
            onSuccess: () => {
              setReplying(false);
            },
          },
        );
      }}
      onCancel={() => {
        setReplying(false);
      }}
    />
  );
}

/** One thread: its comments with delivery chips, a reply box, resolve and reopen. */
export function ThreadCard({
  thread,
  index,
  selected,
  currentVersion,
  viewedVersion = currentVersion,
  onSelect,
  onViewVersion,
}: {
  readonly thread: ThreadView;
  readonly index: number | null;
  readonly selected: boolean;
  readonly currentVersion: number | null;
  /** The version on screen; threads opened on another one say so. Defaults to `currentVersion`. */
  readonly viewedVersion?: number | null;
  readonly onSelect: (threadId: string) => void;
  readonly onViewVersion?: ((number: number) => void) | undefined;
}): React.JSX.Element {
  const resolve = useSetResolved();
  const open = thread.state === "open";
  const anyEditable = thread.comments.some(
    (comment) =>
      comment.editableUntil !== null && comment.delivery?.state === "queued",
  );
  const now = useNow(anyEditable);
  const stale = isOtherVersion(thread.versionNumber, viewedVersion);

  return (
    <li
      className="ar-thread"
      id={`thread-${thread.id}`}
      data-selected={selected}
      data-state={thread.state}
      data-testid="thread"
    >
      <div className="ar-thread-head">
        <button
          type="button"
          className="ar-thread-title"
          aria-pressed={selected}
          onClick={() => {
            onSelect(thread.id);
          }}
        >
          {index === null ? null : (
            <span className="ar-pin-badge" data-hollow={stale}>
              {index}
            </span>
          )}
          <span>{anchorLabel(thread.anchor)}</span>
        </button>
        {stale && thread.versionNumber !== null ? (
          <>
            <span className="ar-tag" data-testid="on-version">
              on v{thread.versionNumber}
            </span>
            {onViewVersion === undefined ? null : (
              <button
                type="button"
                className="ar-link-button"
                onClick={() => {
                  if (thread.versionNumber !== null)
                    onViewVersion(thread.versionNumber);
                }}
              >
                View on v{thread.versionNumber}
              </button>
            )}
          </>
        ) : null}
        {open ? null : <span className="ar-tag">resolved</span>}
        <span className="ar-grow" />
        <button
          type="button"
          className="ar-link-button"
          disabled={resolve.isPending}
          aria-keyshortcuts={selected ? "E" : undefined}
          onClick={() => {
            resolve.mutate({ threadId: thread.id, resolved: open });
          }}
        >
          {open ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <RotateCcwIcon aria-hidden="true" />
          )}
          {open ? "Resolve" : "Reopen"}
        </button>
      </div>
      <ul className="ar-comments">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            thread={thread}
            currentVersion={currentVersion}
            now={now}
          />
        ))}
      </ul>
      {open ? <ReplyBox threadId={thread.id} selected={selected} /> : null}
    </li>
  );
}
