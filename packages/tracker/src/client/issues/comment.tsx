import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, refresh, type IssueDetailData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ActorChip, ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { Markdown } from "#client/ui/markdown.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
import { announce } from "#client/shell/announce.tsx";
export function Comment({
  comment,
  disabled,
}: {
  comment: IssueDetailData["comments"][number];
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const change = useMutation({
    mutationFn: (remove: boolean) =>
      remove
        ? api.comments.delete.mutate({ actor: currentActor(), id: comment.id })
        : api.comments.update.mutate({
            actor: currentActor(),
            id: comment.id,
            body,
          }),
    onSuccess: (_result, removed) => {
      setEditing(false);
      announce(removed ? "Comment deleted" : "Comment updated");
      void refresh();
    },
  });
  return (
    <article className="comment">
      <div className="comment-meta">
        <ActorChip actor={comment.author} />
        <span className="comment-time">
          <RelativeTime value={comment.createdAt} />
          {comment.editedAt === null ? "" : " · edited"}
        </span>
        <span className="spacer" />
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          className="icon-button"
          disabled={disabled}
          aria-label="Delete comment"
          onClick={() => {
            setConfirmDelete(true);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate(false);
          }}
        >
          <textarea
            aria-label="Edit comment"
            required
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button disabled={change.isPending} className="primary">
              Save comment
            </button>
          </div>
        </form>
      ) : (
        <Markdown body={comment.body} />
      )}
      {change.error !== null && <ErrorNotice error={change.error} />}
      <Modal
        title="Delete comment?"
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
        }}
      >
        <p>The original text remains in the audit history.</p>
        <div className="actions">
          <button
            onClick={() => {
              setConfirmDelete(false);
            }}
          >
            Cancel
          </button>
          <button
            className="danger"
            onClick={() => {
              change.mutate(true);
            }}
          >
            Delete comment
          </button>
        </div>
      </Modal>
    </article>
  );
}
