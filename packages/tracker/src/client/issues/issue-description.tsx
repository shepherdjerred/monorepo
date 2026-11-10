import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, refresh, type IssueDetailData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ErrorNotice } from "#client/ui/ui.tsx";
import { Markdown, MarkdownEditor } from "#client/ui/markdown.tsx";
import { announce } from "#client/shell/announce.tsx";

export function IssueDescription({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(issue.description);
  const [attachmentIds, setAttachments] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      api.issues.update.mutate({
        actor: currentActor(),
        identifier: issue.identifier,
        expectedRevision: issue.revision,
        description: body,
        attachmentIds,
      }),
    onSuccess: () => {
      setEditing(false);
      setAttachments([]);
      announce("Description saved");
      void refresh();
    },
  });
  if (!editing)
    return (
      <div className="description-block">
        <Markdown body={issue.description || "_No description yet._"} />
        <button
          id="edit-description"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setBody(issue.description);
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
        save.mutate();
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
        value={body}
        onChange={setBody}
        onAttachments={(ids) => {
          setAttachments((previous) => [...previous, ...ids]);
        }}
        placeholder="Add a description…"
        label="Description"
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
        <button className="primary" disabled={disabled || save.isPending}>
          Save description
        </button>
      </div>
      {save.error !== null && <ErrorNotice error={save.error} />}
    </form>
  );
}
