import { CalendarClock } from "lucide-react";
import type { Issue } from "#client/data/api.ts";
import { localToday, type CalendarDay } from "./dates.ts";
import { dueFullLabel, dueLabel, dueTone } from "./due-display.ts";
import { duePanel } from "./due-picker.tsx";

/** A due date as a coloured chip: overdue, due soon, or later. */
export function DueDate({
  due,
  state,
  today = localToday(),
}: {
  due: CalendarDay;
  state: Issue["state"]["type"];
  today?: CalendarDay;
}) {
  const tone = dueTone(due, today, state);
  return (
    <span className="due-chip" data-tone={tone}>
      <CalendarClock size={13} aria-hidden="true" />
      <time dateTime={due} title={dueFullLabel(due)}>
        {dueLabel(due, today)}
      </time>
      {tone === "overdue" && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

/**
 * The due date on a list row or board card, edited in place. Like the
 * row's other controls it is out of the tab order; Shift+D opens it.
 */
export function RowDue({
  issue,
  disabled,
  onFocus,
  open,
}: {
  issue: Issue;
  disabled: boolean;
  onFocus: () => void;
  open: (anchor: HTMLElement) => void;
}) {
  if (issue.dueDate === null) {
    return null;
  }
  return (
    <button
      type="button"
      className="row-control row-due"
      tabIndex={-1}
      disabled={disabled}
      aria-haspopup="dialog"
      data-picker="due"
      data-issue={issue.identifier}
      onPointerEnter={duePanel.prefetch}
      onFocus={() => {
        onFocus();
        duePanel.prefetch();
      }}
      onClick={(event) => {
        open(event.currentTarget);
      }}
    >
      <span className="sr-only">Due date of {issue.identifier}: </span>
      <DueDate due={issue.dueDate} state={issue.state.type} />
    </button>
  );
}
