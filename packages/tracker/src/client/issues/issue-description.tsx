import { useState } from "react";
import type { IssueDetailData } from "#client/data/api.ts";
import { useDraft } from "#client/data/drafts.ts";
import { editIssue } from "#client/data/mutations.ts";
import { Markdown, MarkdownEditor } from "#client/ui/markdown.tsx";

export function IssueDescription({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const draft = useDraft(`description:${issue.identifier}`, issue.description);
  // An edit left unfinished is still open when the issue is opened again.
  const [editing, setEditing] = useState(draft.dirty);
  async function save() {
    // The new text shows at once. The draft outlives the request, so a
    // refused save reopens the editor with nothing lost.
    setEditing(false);
    const outcome = await editIssue(issue.identifier, {
      kind: "description",
      description: draft.text,
      attachmentIds: draft.attachments,
    });
    if (outcome.ok) {
      draft.reset(draft.text);
    } else {
      setEditing(true);
    }
  }
  if (!editing)
    return (
      <div className="description-block">
        <Markdown body={issue.description || "_No description yet._"} />
        <button
          id="edit-description"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            draft.reset(issue.description);
            setEditing(true);
          }}
        >
          Edit description
        </button>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      <MarkdownEditor
        id="description-editor"
        value={draft.text}
        onChange={draft.setText}
        onAttachments={draft.addAttachments}
        placeholder="Add a description…"
        label="Description"
      />
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            draft.reset(issue.description);
            setEditing(false);
          }}
        >
          Cancel
        </button>
        <button className="primary" disabled={disabled}>
          Save description
        </button>
      </div>
    </form>
  );
}
