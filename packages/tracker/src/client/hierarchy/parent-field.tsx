import { useState } from "react";
import { GitFork, X } from "lucide-react";
import type { IssueDetailData } from "#client/data/api.ts";
import { editIssue, loadedIssue } from "#client/data/mutations.ts";
import { applyChange } from "#client/controls/issue-actions.ts";
import { IssueSearchCombobox } from "#client/controls/issue-search.tsx";
import { Modal } from "#client/ui/ui.tsx";
import { isComposing } from "#client/ui/ime.ts";
import {
  cannotParent,
  parentRequest,
  removeParent,
} from "./hierarchy-actions.ts";

/** The Parent property: the parent as a link, changed through issue search. */
export function ParentField({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const { parent } = issue;
  const finish = () => {
    setEditing(false);
    setText("");
  };
  return (
    <div className="property-field">
      <span className="property-name" id="property-parent-name">
        Parent
      </span>
      {editing ? (
        <div
          className="parent-search"
          onKeyDown={(event) => {
            // Escape during an IME conversion cancels the conversion only.
            if (event.key === "Escape" && !isComposing(event.nativeEvent)) {
              event.stopPropagation();
              finish();
            }
          }}
        >
          <IssueSearchCombobox
            id="property-parent-search"
            label={`Parent of ${issue.identifier}`}
            placeholder="Search for a parent…"
            value={text}
            onValueChange={setText}
            exclude={[
              issue.identifier,
              ...issue.children.map(({ identifier }) => identifier),
            ]}
            autoFocus
            onPick={(identifier) => {
              finish();
              void editIssue(issue.identifier, {
                kind: "parent",
                parentIdentifier: identifier,
              });
            }}
          />
        </div>
      ) : (
        <div className="property-parent">
          <button
            type="button"
            id="property-parent"
            className="property-value"
            aria-labelledby="property-parent-name property-parent"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
            }}
          >
            <GitFork size={15} aria-hidden="true" />
            {parent === null ? (
              <span className="muted">Set parent</span>
            ) : (
              <span className="parent-value" title={parent.title}>
                <span className="identifier">{parent.identifier}</span>{" "}
                {parent.title}
              </span>
            )}
          </button>
          {parent !== null && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove parent ${parent.identifier}`}
              disabled={disabled}
              onClick={() => {
                void editIssue(issue.identifier, {
                  kind: "parent",
                  parentIdentifier: null,
                });
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Set parent…" from a row, the context menu or a selection. */
export function ParentDialog() {
  const request = parentRequest.use();
  const [text, setText] = useState("");
  const close = () => {
    parentRequest.set(undefined);
    setText("");
  };
  const identifiers = request ?? [];
  const subject =
    identifiers.length === 1
      ? (identifiers[0] ?? "")
      : `${String(identifiers.length)} issues`;
  const parented =
    request !== undefined &&
    identifiers.some((identifier) => loadedIssue(identifier).parent !== null);
  return (
    <Modal
      title={`Set parent of ${subject}`}
      open={request !== undefined}
      onClose={close}
    >
      {request !== undefined && (
        <form
          className="parent-dialog"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <IssueSearchCombobox
            label={`Parent of ${subject}`}
            placeholder="Search for a parent…"
            value={text}
            onValueChange={setText}
            exclude={cannotParent(identifiers)}
            autoFocus
            onPick={(parentIdentifier) => {
              close();
              applyChange(identifiers, { kind: "parent", parentIdentifier });
            }}
          />
          {parented && (
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  close();
                  removeParent(identifiers);
                }}
              >
                Remove parent
              </button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
