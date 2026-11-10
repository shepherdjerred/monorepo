import type { ReactNode } from "react";
import {
  Archive,
  CircleDashed,
  Folder,
  SignalHigh,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { deleteIssues } from "#client/data/mutations.ts";
import { Modal } from "#client/ui/ui.tsx";
import { EnumPicker } from "./enum-picker.tsx";
import { SearchPickerHost } from "./search-picker.tsx";
import {
  applyChange,
  cancelDelete,
  confirmDelete,
  pickProperty,
  toggleArchived,
  useDeleteRequest,
} from "./issue-actions.ts";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "./property-options.tsx";
import {
  emptySelection,
  selectedInOrder,
  selectionStore,
  useSelection,
} from "./selection.ts";

function SearchButton({
  id,
  icon,
  text,
  open,
  disabled,
}: {
  id: string;
  icon: ReactNode;
  text: string;
  open: (anchor: HTMLElement) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      className="bulk-action"
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={(event) => {
        open(event.currentTarget);
      }}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}

/**
 * The floating bar a selection brings up: how many issues are picked and the
 * edits that apply to all of them at once, each with one Undo.
 */
export function BulkBar({
  bootstrap,
  teamKey,
  scope,
  loaded,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  scope: string;
  /** The identifiers the list has loaded; picks outside it are ignored. */
  loaded: readonly string[];
}) {
  const selection = useSelection(scope);
  const identifiers = selectedInOrder(selection, loaded);
  if (identifiers.length === 0) {
    return null;
  }
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const disabled = !bootstrap.writesEnabled;
  const clear = () => {
    selectionStore.update(scope, () => emptySelection);
  };
  return (
    <section className="bulk-bar" aria-label="Selected issues">
      <span className="bulk-count">
        <strong>{identifiers.length}</strong> selected
      </span>
      <EnumPicker
        id="bulk-state"
        label={`Set status of ${String(identifiers.length)} issues`}
        variant="action"
        action={{ text: "Status", icon: <CircleDashed size={14} /> }}
        value=""
        disabled={disabled}
        options={stateOptions(
          team === undefined ? [] : teamStates(bootstrap, team.id),
        )}
        onChange={(stateName) => {
          applyChange(identifiers, { kind: "state", stateName });
        }}
      />
      <EnumPicker
        id="bulk-priority"
        label={`Set priority of ${String(identifiers.length)} issues`}
        variant="action"
        action={{ text: "Priority", icon: <SignalHigh size={14} /> }}
        value=""
        disabled={disabled}
        options={priorityOptions}
        onChange={(priority) => {
          applyChange(identifiers, {
            kind: "priority",
            priority: Number(priority),
          });
        }}
      />
      <SearchButton
        id="bulk-assignee"
        icon={<UserRound size={14} aria-hidden="true" />}
        text="Assignee"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("assignee", identifiers, anchor);
        }}
      />
      <SearchButton
        id="bulk-labels"
        icon={<Tag size={14} aria-hidden="true" />}
        text="Labels"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("labels", identifiers, anchor);
        }}
      />
      <SearchButton
        id="bulk-project"
        icon={<Folder size={14} aria-hidden="true" />}
        text="Project"
        disabled={disabled}
        open={(anchor) => {
          pickProperty("project", identifiers, anchor);
        }}
      />
      <button
        type="button"
        className="bulk-action"
        disabled={disabled}
        onClick={() => {
          toggleArchived(identifiers);
        }}
      >
        <Archive size={14} aria-hidden="true" />
        <span>Archive</span>
      </button>
      <button
        type="button"
        className="bulk-action bulk-danger"
        disabled={disabled}
        onClick={() => {
          confirmDelete(identifiers);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
        <span>Delete</span>
      </button>
      <button
        type="button"
        className="icon-button bulk-clear"
        aria-label={`Clear ${String(identifiers.length)} selected`}
        title="Clear selection (Esc)"
        onClick={clear}
      >
        <X size={16} />
        <span className="bulk-clear-count" aria-hidden="true">
          {identifiers.length}
        </span>
      </button>
    </section>
  );
}

/** Asks before deleting; one Undo then brings every issue back. */
export function DeleteConfirm({ scope }: { scope: string }) {
  const request = useDeleteRequest();
  const count = request?.length ?? 0;
  const what =
    count === 1 ? (request?.[0] ?? "this issue") : `${String(count)} issues`;
  return (
    <Modal
      title={count === 1 ? "Delete this issue?" : `Delete ${what}?`}
      open={request !== undefined}
      onClose={cancelDelete}
    >
      <p>
        {count === 1
          ? "The issue and its comments"
          : "The issues and their comments"}{" "}
        will be removed. Their audit history and attachments remain available.
      </p>
      <div className="actions">
        <button onClick={cancelDelete}>Cancel</button>
        <button
          className="danger"
          onClick={() => {
            if (request !== undefined) {
              deleteIssues(request);
              selectionStore.update(scope, () => emptySelection);
            }
            cancelDelete();
          }}
        >
          Delete {what}
        </button>
      </div>
    </Modal>
  );
}

/** The page-level controls: the searchable picker, bulk bar and delete dialog. */
export function ControlsLayer({
  bootstrap,
  teamKey,
  scope,
  loaded,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  scope: string;
  loaded: readonly string[];
}) {
  return (
    <>
      <SearchPickerHost bootstrap={bootstrap} />
      {scope !== "" && (
        <BulkBar
          bootstrap={bootstrap}
          teamKey={teamKey}
          scope={scope}
          loaded={loaded}
        />
      )}
      <DeleteConfirm scope={scope} />
    </>
  );
}
