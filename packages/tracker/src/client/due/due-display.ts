import {
  addDays,
  daysBetween,
  displayDate,
  endOfWeek,
  type CalendarDay,
} from "./dates.ts";

type StateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate";

/** Finished work is never overdue, whatever its date. */
export const isFinished = (type: StateType) =>
  type === "completed" || type === "canceled" || type === "duplicate";

export type DueTone = "overdue" | "soon" | "later";

/** How a due chip is coloured: danger, warning, or muted. */
export function dueTone(
  due: CalendarDay,
  today: CalendarDay,
  state: StateType,
): DueTone {
  if (isFinished(state)) {
    return "later";
  }
  if (due < today) {
    return "overdue";
  }
  return due <= addDays(today, 1) ? "soon" : "later";
}

const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const shortDateYear = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

/**
 * What a due chip says: "Today", "Tomorrow", "Yesterday", a weekday within
 * the coming six days, else a short date, with its year when not this one.
 */
export function dueLabel(due: CalendarDay, today: CalendarDay) {
  const distance = daysBetween(today, due);
  if (distance === 0) {
    return "Today";
  }
  if (distance === 1) {
    return "Tomorrow";
  }
  if (distance === -1) {
    return "Yesterday";
  }
  const date = displayDate(due);
  if (distance > 1 && distance <= 6) {
    return weekdayLong.format(date);
  }
  return (
    due.slice(0, 4) === today.slice(0, 4) ? shortDate : shortDateYear
  ).format(date);
}

/** The full date, for a tooltip or a screen reader. */
export const dueFullLabel = (due: CalendarDay) =>
  fullDate.format(displayDate(due));

export type DueBucket =
  "overdue" | "today" | "week" | "later" | "none" | "past";

export const dueBucketLabels: Record<DueBucket, string> = {
  past: "Earlier",
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No due date",
};
export const dueBucketOrder: readonly DueBucket[] = [
  "past",
  "overdue",
  "today",
  "week",
  "later",
  "none",
];

/**
 * The group an issue falls in when a list groups by due date. Finished work
 * dated before today goes under "Earlier", not "Overdue".
 */
export function dueBucket(
  due: CalendarDay | null,
  today: CalendarDay,
  state: StateType,
): DueBucket {
  if (due === null) {
    return "none";
  }
  if (due < today) {
    return isFinished(state) ? "past" : "overdue";
  }
  if (due === today) {
    return "today";
  }
  return due <= endOfWeek(today) ? "week" : "later";
}
