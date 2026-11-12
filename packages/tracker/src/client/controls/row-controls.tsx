import { Tag } from "lucide-react";
import type { Issue } from "#client/data/api.ts";
import { Avatar, Swatch } from "#client/ui/ui.tsx";
import { EnumPicker, type EnumOption } from "./enum-picker.tsx";
import { applyChange, pickProperty } from "./issue-actions.ts";

/**
 * Properties edited in place on a list row or a board card. They stay out of
 * the tab order — the row is one tab stop and S, P, A and L open these — and
 * pressing one never opens the peek.
 */
type RowProps = {
  issue: Issue;
  disabled: boolean;
  onFocus: () => void;
};

export function RowStatus({
  issue,
  options,
  disabled,
  onFocus,
}: RowProps & { options: readonly EnumOption[] }) {
  return (
    <EnumPicker
      variant="icon"
      label={`Status of ${issue.identifier}`}
      value={issue.state.name}
      options={options}
      disabled={disabled}
      tabIndex={-1}
      picker="state"
      issue={issue.identifier}
      onFocus={onFocus}
      onChange={(stateName) => {
        applyChange([issue.identifier], { kind: "state", stateName });
      }}
    />
  );
}

export function RowPriority({
  issue,
  options,
  disabled,
  onFocus,
}: RowProps & { options: readonly EnumOption[] }) {
  return (
    <EnumPicker
      variant="icon"
      label={`Priority of ${issue.identifier}`}
      value={String(issue.priority)}
      options={options}
      disabled={disabled}
      tabIndex={-1}
      picker="priority"
      issue={issue.identifier}
      onFocus={onFocus}
      onChange={(priority) => {
        applyChange([issue.identifier], {
          kind: "priority",
          priority: Number(priority),
        });
      }}
    />
  );
}

export function RowAssignee({ issue, disabled, onFocus }: RowProps) {
  const name = issue.assignee?.name ?? "Unassigned";
  return (
    <button
      type="button"
      className="row-control row-assignee"
      tabIndex={-1}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={`Assignee of ${issue.identifier}: ${name}`}
      title={name}
      data-picker="assignee"
      data-issue={issue.identifier}
      onFocus={onFocus}
      onClick={(event) => {
        pickProperty("assignee", [issue.identifier], event.currentTarget);
      }}
    >
      {issue.assignee === null ? (
        <span className="unassigned" aria-hidden="true" />
      ) : (
        <Avatar actor={issue.assignee} decorative />
      )}
    </button>
  );
}

export function RowLabels({
  issue,
  disabled,
  onFocus,
  limit,
}: RowProps & { limit: number }) {
  const shown = issue.labels.slice(0, limit);
  const more = issue.labels.length - shown.length;
  return (
    <button
      type="button"
      className={`row-control row-labels ${issue.labels.length === 0 ? "is-empty" : ""}`}
      tabIndex={-1}
      disabled={disabled}
      aria-haspopup="dialog"
      data-picker="labels"
      data-issue={issue.identifier}
      onFocus={onFocus}
      onClick={(event) => {
        pickProperty("labels", [issue.identifier], event.currentTarget);
      }}
    >
      {/* Only screen readers hear the prefix; the labels shown are the rest. */}
      <span className="sr-only">Labels of {issue.identifier}: </span>
      {shown.map((label) => (
        <span className="label" key={label.id}>
          <Swatch color={label.color} />
          {label.name}{" "}
        </span>
      ))}
      {more > 0 && <span className="label">+{more}</span>}
      {issue.labels.length === 0 && (
        <>
          <Tag size={13} aria-hidden="true" />
          <span className="sr-only">none</span>
        </>
      )}
    </button>
  );
}
