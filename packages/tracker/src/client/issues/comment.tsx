import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { IssueDetailData } from "#client/data/api.ts";
import { deleteComment, editComment } from "#client/data/detail-mutations.ts";
import { useDraft } from "#client/data/drafts.ts";
import { ActorChip, Modal } from "#client/ui/ui.tsx";
import { Markdown } from "#client/ui/markdown.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
export function Comment({
  identifier,
  comment,
  disabled,
}: {
  /** The issue the comment belongs to. */
  identifier: string;
  comment: IssueDetailData["comments"][number];
  disabled: boolean;
}) {
  const draft = useDraft(`comment-edit:${comment.id}`, comment.body);
  // An edit left unfinished is still open when the issue is opened again.
  const [editing, setEditing] = useState(draft.dirty);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A comment still being posted has no server id to edit or delete yet.
  const locked = disabled || comment.id.startsWith("optimistic-");
  async function save() {
    // The draft outlives the request, so a refused save reopens the editor.
    setEditing(false);
    const outcome = await editComment(identifier, comment, draft.text);
    if (outcome.ok) {
      draft.reset(draft.text);
    } else {
      setEditing(true);
    }
  }
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
          disabled={locked}
          onClick={() => {
            draft.reset(comment.body);
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          className="icon-button"
          disabled={locked}
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
            void save();
          }}
        >
          <textarea
            aria-label="Edit comment"
            required
            value={draft.text}
            onChange={(e) => {
              draft.setText(e.target.value);
            }}
          />
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                draft.reset(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button className="primary">Save comment</button>
          </div>
        </form>
      ) : (
        <Markdown body={comment.body} />
      )}
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
              setConfirmDelete(false);
              void deleteComment(identifier, comment);
            }}
          >
            Delete comment
          </button>
        </div>
      </Modal>
    </article>
  );
}
