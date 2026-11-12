import { z } from "zod";
import type { IssueListInput } from "#shared/schema.ts";
import { endOfWeek, parseDay, type CalendarDay } from "./dates.ts";
import { dueLabel } from "./due-display.ts";

/**
 * The `due` filter of a list address: a preset, or a day meaning "due on or
 * before it". Presets are relative, so a shared link or a saved view means
 * the same thing tomorrow; the browser supplies its own `today`.
 */
export const duePresets = ["overdue", "today", "week", "none"] as const;
export type DuePreset = (typeof duePresets)[number];

export const duePresetNames: Record<DuePreset, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  none: "No due date",
};

/** Work that is still open; overdue finished work is not overdue. */
const openTypes = ["triage", "backlog", "unstarted", "started"];

const DuePresetSchema = z.enum(duePresets);

export const isDueFilter = (value: string) =>
  DuePresetSchema.safeParse(value).success || parseDay(value) !== undefined;

type DueInput = Partial<
  Pick<
    IssueListInput,
    "overdue" | "today" | "dueBefore" | "dueAfter" | "hasDueDate" | "states"
  >
>;

/**
 * The `issues.list` filters a `due` value stands for. Overdue leaves out
 * finished work unless the list already filters by status.
 */
export function dueFilterInput(
  value: string | null,
  today: CalendarDay,
  filteredByState: boolean,
): DueInput {
  if (value === null) {
    return {};
  }
  switch (value) {
    case "overdue": {
      return {
        overdue: true,
        today,
        ...(filteredByState ? {} : { states: openTypes }),
      };
    }
    case "today": {
      return { dueAfter: today, dueBefore: today };
    }
    case "week": {
      return { dueAfter: today, dueBefore: endOfWeek(today) };
    }
    case "none": {
      return { hasDueDate: false };
    }
  }
  if (parseDay(value) === undefined) {
    throw new Error(`${value} is not a due date filter`);
  }
  return { dueBefore: value };
}

/** How a filter chip names a `due` value. */
export function dueFilterName(value: string, today: CalendarDay) {
  const preset = DuePresetSchema.safeParse(value);
  return preset.success
    ? duePresetNames[preset.data]
    : `Due by ${dueLabel(value, today)}`;
}
