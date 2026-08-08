import { parseLocalDate, toISODate } from "../lib/dates";
import { isActiveStatus } from "./status";
import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  nextOccurrenceAfter,
  occursOn,
} from "./recurrence";
import type { Task } from "./types";

export type AgendaDateKind = "planned" | "deadline";
export type TodayAgendaSectionKey = "overdue" | "scheduled-today" | "due-today";

export type AgendaDateReason = {
  readonly kind: AgendaDateKind;
  readonly day: string;
  readonly recurring: boolean;
};

export type TodayAgendaEntry = {
  readonly task: Task;
  readonly section: TodayAgendaSectionKey;
  readonly day: string;
  readonly completionDay?: string;
  readonly primaryKind: AgendaDateKind;
  readonly reasons: readonly AgendaDateReason[];
};

export type TodayAgendaSection = {
  readonly key: TodayAgendaSectionKey;
  readonly title: string;
  readonly entries: readonly TodayAgendaEntry[];
};

export type UpcomingAgendaEntry = {
  readonly task: Task;
  readonly day: string;
  readonly completionDay?: string;
  readonly primaryKind: AgendaDateKind;
  readonly reasons: readonly AgendaDateReason[];
};

export type UpcomingAgendaSection = {
  readonly day: string;
  readonly entries: readonly UpcomingAgendaEntry[];
};

export type UpcomingWeekDay = {
  readonly day: string;
  readonly count: number;
};

const TODAY_SECTION_ORDER: readonly TodayAgendaSectionKey[] = [
  "overdue",
  "scheduled-today",
  "due-today",
];

const TODAY_SECTION_TITLES: Readonly<Record<TodayAgendaSectionKey, string>> = {
  overdue: "Overdue",
  "scheduled-today": "Today",
  "due-today": "Due Today",
};

function taskDay(value: string): string {
  const parsed = parseLocalDate(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`agenda: invalid task date "${value}"`);
  }
  const normalized = toISODate(parsed);
  if (normalized !== value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`agenda: invalid task date "${value}"`);
  }
  return normalized;
}

function validateDay(day: string): string {
  const normalized = taskDay(day);
  if (normalized !== day) {
    throw new TypeError(`agenda: expected YYYY-MM-DD, received "${day}"`);
  }
  return normalized;
}

function assertUniqueTaskIds(tasks: readonly Task[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`agenda: duplicate task id "${task.id}"`);
    }
    seen.add(task.id);
  }
}

function activeTasks(tasks: readonly Task[]): readonly Task[] {
  assertUniqueTaskIds(tasks);
  return tasks.filter((task) => !task.archived && isActiveStatus(task.status));
}

function addReason(
  reasons: AgendaDateReason[],
  reason: AgendaDateReason,
): void {
  const duplicateIndex = reasons.findIndex(
    (candidate) =>
      candidate.kind === reason.kind && candidate.day === reason.day,
  );
  if (duplicateIndex === -1) {
    reasons.push(reason);
    return;
  }
  const existing = reasons[duplicateIndex];
  if (existing !== undefined && reason.recurring && !existing.recurring) {
    reasons[duplicateIndex] = reason;
  }
}

function reasonsForToday(task: Task, today: string): AgendaDateReason[] {
  const reasons: AgendaDateReason[] = [];
  const recurring = isRecurring(task);

  // For a recurring task, `scheduled` is the current uncompleted occurrence.
  // The immutable series anchor lives in DTSTART after progression begins.
  // Keeping this date aligned with completionTargetDate ensures the row that
  // appears overdue is the same occurrence a checkbox tap completes.
  if (task.scheduled !== undefined) {
    const day = taskDay(task.scheduled);
    if (day <= today) {
      addReason(reasons, { kind: "planned", day, recurring });
    }
  }

  if (task.due !== undefined) {
    const day = taskDay(task.due);
    if (day <= today) {
      addReason(reasons, { kind: "deadline", day, recurring: false });
    }
  }

  if (recurring && task.scheduled === undefined && occursOn(task, today)) {
    addReason(reasons, { kind: "planned", day: today, recurring: true });
  }

  return reasons;
}

function todaySection(
  reasons: readonly AgendaDateReason[],
  today: string,
): TodayAgendaSectionKey {
  if (reasons.some((reason) => reason.day < today)) return "overdue";
  if (reasons.some((reason) => reason.kind === "planned")) {
    return "scheduled-today";
  }
  return "due-today";
}

function primaryReasonForToday(
  reasons: readonly AgendaDateReason[],
  section: TodayAgendaSectionKey,
  today: string,
): AgendaDateReason {
  const matching = reasons.filter((reason) => {
    switch (section) {
      case "overdue":
        return reason.day < today;
      case "scheduled-today":
        return reason.day === today && reason.kind === "planned";
      case "due-today":
        return reason.day === today && reason.kind === "deadline";
    }
  });
  const first = matching[0];
  if (first === undefined) {
    throw new Error(`agenda: no primary reason for Today section ${section}`);
  }
  return matching
    .slice(1)
    .reduce(
      (earliest, reason) => (reason.day < earliest.day ? reason : earliest),
      first,
    );
}

function earliestReasonDay(reasons: readonly AgendaDateReason[]): string {
  const first = reasons[0];
  if (first === undefined) {
    throw new Error(
      "agenda: an agenda entry requires at least one date reason",
    );
  }
  let earliest = first.day;
  for (const reason of reasons.slice(1)) {
    if (reason.day < earliest) earliest = reason.day;
  }
  return earliest;
}

function compareTodayEntries(
  left: TodayAgendaEntry,
  right: TodayAgendaEntry,
): number {
  const byDate = earliestReasonDay(left.reasons).localeCompare(
    earliestReasonDay(right.reasons),
  );
  if (byDate !== 0) return byDate;
  return left.task.title.localeCompare(right.task.title);
}

function completionDayForAgendaEntry(
  task: Task,
  reasons: readonly AgendaDateReason[],
  today: string,
): string | undefined {
  if (!isRecurring(task)) return undefined;
  if (task.recurrenceAnchor === "completion") {
    return completionTargetDate(task, today);
  }
  const occurrence = reasons.find(
    (reason) => reason.kind === "planned" && reason.recurring,
  );
  return occurrence?.day ?? completionTargetDate(task, today);
}

export function deriveTodayAgenda(
  tasks: readonly Task[],
  today: string,
): readonly TodayAgendaSection[] {
  const normalizedToday = validateDay(today);
  const bySection = new Map<TodayAgendaSectionKey, TodayAgendaEntry[]>();

  for (const task of activeTasks(tasks)) {
    const reasons = reasonsForToday(task, normalizedToday);
    if (reasons.length === 0) continue;
    const completionDay = completionDayForAgendaEntry(
      task,
      reasons,
      normalizedToday,
    );
    if (completionDay !== undefined && isCompletedOn(task, completionDay)) {
      continue;
    }
    const section = todaySection(reasons, normalizedToday);
    const primaryReason = primaryReasonForToday(
      reasons,
      section,
      normalizedToday,
    );
    const entries = bySection.get(section) ?? [];
    entries.push({
      task,
      section,
      day: primaryReason.day,
      ...(completionDay === undefined ? {} : { completionDay }),
      primaryKind: primaryReason.kind,
      reasons,
    });
    bySection.set(section, entries);
  }

  const sections: TodayAgendaSection[] = [];
  for (const key of TODAY_SECTION_ORDER) {
    const entries = bySection.get(key);
    if (entries === undefined || entries.length === 0) continue;
    sections.push({
      key,
      title: TODAY_SECTION_TITLES[key],
      entries: [...entries].sort(compareTodayEntries),
    });
  }
  return sections;
}

function reasonsForUpcoming(
  task: Task,
  today: string,
  recurrenceHorizonDays: number,
): AgendaDateReason[] {
  const reasons: AgendaDateReason[] = [];
  const recurring = isRecurring(task);
  let currentOccurrenceProcessed = false;

  if (task.scheduled !== undefined) {
    const day = taskDay(task.scheduled);
    currentOccurrenceProcessed =
      task.completeInstances.includes(day) ||
      task.skippedInstances.includes(day);
    if (!currentOccurrenceProcessed && day > today) {
      addReason(reasons, { kind: "planned", day, recurring });
    }
  }

  if (task.due !== undefined) {
    const day = taskDay(task.due);
    const processed =
      task.completeInstances.includes(day) ||
      task.skippedInstances.includes(day);
    currentOccurrenceProcessed ||= processed;
    if (!processed && day > today) {
      addReason(reasons, { kind: "deadline", day, recurring: false });
    }
  }

  // `scheduled` (or its `due` fallback) is the current uncompleted
  // occurrence. Do not also preview a later RRULE date while that occurrence
  // is still actionable; doing so makes the visible row complete a different
  // date. A date-less recurring task has no current occurrence field, so its
  // next RRULE day is the explicit completion target carried by the agenda.
  if (
    recurring &&
    (currentOccurrenceProcessed ||
      (task.scheduled === undefined && task.due === undefined))
  ) {
    const occurrence = nextOccurrenceAfter(task, today, recurrenceHorizonDays);
    if (occurrence !== undefined) {
      addReason(reasons, {
        kind: "planned",
        day: occurrence,
        recurring: true,
      });
    }
  }

  return reasons;
}

function primaryKindForDay(
  reasons: readonly AgendaDateReason[],
  day: string,
): AgendaDateKind {
  if (
    reasons.some((reason) => reason.day === day && reason.kind === "planned")
  ) {
    return "planned";
  }
  return "deadline";
}

function compareUpcomingEntries(
  left: UpcomingAgendaEntry,
  right: UpcomingAgendaEntry,
): number {
  if (left.primaryKind !== right.primaryKind) {
    return left.primaryKind === "planned" ? -1 : 1;
  }
  return left.task.title.localeCompare(right.task.title);
}

export function deriveUpcomingAgenda(
  tasks: readonly Task[],
  today: string,
  recurrenceHorizonDays = 366,
): readonly UpcomingAgendaSection[] {
  const normalizedToday = validateDay(today);
  if (!Number.isInteger(recurrenceHorizonDays) || recurrenceHorizonDays < 1) {
    throw new TypeError(
      "agenda: recurrence horizon must be a positive integer",
    );
  }

  const byDay = new Map<string, UpcomingAgendaEntry[]>();
  for (const task of activeTasks(tasks)) {
    const reasons = reasonsForUpcoming(
      task,
      normalizedToday,
      recurrenceHorizonDays,
    );
    if (reasons.length === 0) continue;
    const completionDay = completionDayForAgendaEntry(
      task,
      reasons,
      normalizedToday,
    );
    if (completionDay !== undefined && isCompletedOn(task, completionDay)) {
      continue;
    }
    const day = earliestReasonDay(reasons);
    const entries = byDay.get(day) ?? [];
    entries.push({
      task,
      day,
      ...(completionDay === undefined ? {} : { completionDay }),
      primaryKind: primaryKindForDay(reasons, day),
      reasons,
    });
    byDay.set(day, entries);
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, entries]) => ({
      day,
      entries: [...entries].sort(compareUpcomingEntries),
    }));
}

/**
 * Counts the same actionable date reasons rendered by Today and Upcoming.
 * A task with both a planned date and deadline can contribute to both days,
 * but never more than once to a single day.
 */
export function deriveAgendaDayCounts(
  tasks: readonly Task[],
  today: string,
  recurrenceHorizonDays = 366,
): ReadonlyMap<string, number> {
  const taskIdsByDay = new Map<string, Set<string>>();
  const addEntry = (task: Task, reasons: readonly AgendaDateReason[]): void => {
    for (const reason of reasons) {
      const taskIds = taskIdsByDay.get(reason.day) ?? new Set<string>();
      taskIds.add(task.id);
      taskIdsByDay.set(reason.day, taskIds);
    }
  };

  for (const section of deriveTodayAgenda(tasks, today)) {
    for (const entry of section.entries) addEntry(entry.task, entry.reasons);
  }
  for (const section of deriveUpcomingAgenda(
    tasks,
    today,
    recurrenceHorizonDays,
  )) {
    for (const entry of section.entries) addEntry(entry.task, entry.reasons);
  }

  return new Map(
    [...taskIdsByDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, taskIds]) => [day, taskIds.size]),
  );
}

export function deriveUpcomingWeek(
  agenda: readonly UpcomingAgendaSection[],
  today: string,
  length = 7,
): readonly UpcomingWeekDay[] {
  const normalizedToday = validateDay(today);
  if (!Number.isInteger(length) || length < 1 || length > 31) {
    throw new TypeError(
      "agenda: upcoming week length must be an integer from 1 through 31",
    );
  }

  const counts = new Map(
    agenda.map((section) => [section.day, section.entries.length]),
  );
  const firstDay = parseLocalDate(normalizedToday);

  return Array.from({ length }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index + 1);
    const day = toISODate(date);
    return { day, count: counts.get(day) ?? 0 };
  });
}
