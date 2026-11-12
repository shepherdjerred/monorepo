import { CalendarClock, CalendarX2 } from "lucide-react";
import { loadedIssue } from "#client/data/mutations.ts";
import { applyChange } from "#client/controls/issue-actions.ts";
import type {
  PaletteEntry,
  PaletteStep,
} from "#client/shell/palette-steps.tsx";
import { deferred } from "#client/ui/lazy.ts";
import { localToday, quickChoices } from "./dates.ts";
import { dueFullLabel, dueLabel } from "./due-display.ts";

/** The date parser loads with the step, before anything is typed into it. */
const parser = deferred(() => import("./parse-due.ts"));

/**
 * The palette's due date step: what is typed, read as a date, then the
 * usual choices and a way to clear it.
 */
export function dueStep(identifiers: string[]): PaletteStep {
  const set = (dueDate: string | null) => () => {
    applyChange(identifiers, { kind: "due", dueDate });
  };
  parser.prefetch();
  return {
    id: "due",
    title: "Set due date",
    placeholder: "Due… try “fri”, “jan 15” or “+3d”",
    entries: (query) => {
      const today = localToday();
      const dates = identifiers.map(
        (identifier) => loadedIssue(identifier).dueDate,
      );
      const typed = parser.current?.parseDue(query, today, navigator.language);
      const entries: PaletteEntry[] = quickChoices(today).map((choice) => ({
        id: `due:${choice.id}`,
        label: `${choice.label} · ${dueLabel(choice.day, today)}`,
        icon: <CalendarClock size={15} />,
        section: "Due date",
        checked: dates.every((date) => date === choice.day),
        run: set(choice.day),
      }));
      if (typed !== undefined) {
        entries.unshift({
          id: "due:typed",
          label: `Due ${dueFullLabel(typed)}`,
          icon: <CalendarClock size={15} />,
          section: "Typed date",
          always: true,
          run: set(typed),
        });
      }
      if (dates.some((date) => date !== null)) {
        entries.push({
          id: "due:clear",
          label: "Clear due date",
          icon: <CalendarX2 size={15} />,
          section: "Due date",
          run: set(null),
        });
      }
      return entries;
    },
  };
}
