import { useState } from "react";
import type { IssueDetailData } from "#client/data/api.ts";
import { queryClient } from "#client/data/api.ts";
import { issueKey } from "#client/data/cache.ts";
import { textWasSaved } from "#client/data/pending-drafts.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { editIssue } from "#client/data/mutations.ts";
import { Markdown, MarkdownEditor } from "#client/ui/markdown.tsx";

export function IssueDescription({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const draft = useDraft(`description:${issue.identifier}`, issue.description, {
    kind: "description",
    subject: issue.identifier,
    saved: (pending) => textWasSaved(pending, issue.description),
    recheck: () =>
      queryClient.invalidateQueries({ queryKey: issueKey(issue.identifier) }),
    notice: "Restored your unsent description",
  });
  // An edit left unfinished is still open when the issue is opened again.
  const [wasEditing, setEditing] = useState(draft.dirty);
  const editing = wasEditing || draft.restored;
  async function save() {
    // The new text shows at once and stops being a draft. A refused save
    // brings the draft back and reopens the editor with nothing lost.
    setEditing(false);
    const outcome = await draft.send(
      ({ text, attachments }) =>
        editIssue(issue.identifier, {
          kind: "description",
          description: text,
          attachmentIds: attachments,
        }),
      draft.text,
    );
    if (!outcome.ok) {
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
