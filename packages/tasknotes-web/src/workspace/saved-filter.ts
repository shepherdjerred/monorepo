import type { Task } from "@shepherdjerred/facet-protocol";
import {
  addDays,
  effectiveCivilDay,
  isCivilDay,
  type CivilDay,
} from "./civil-day.ts";
import type { WorkspaceData } from "#sync/sync.ts";

type Context = { data: WorkspaceData; today: CivilDay; timeZone: string };
type Predicate = (task: Task, context: Context) => boolean;
type Filter = { matches: Predicate; includesCompleted: boolean };

const namedConditions = new Set([
  "no date",
  "7 days",
  "next 7 days",
  "no deadline",
]);
const dateCondition = /^(due|deadline) (before|after):(.*)$/i;

function textContains(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle);
}

function scheduleMatches(
  task: Task,
  context: Context,
  term: string,
): boolean | undefined {
  const { timeZone, today } = context;
  const due = effectiveCivilDay(task, timeZone);
  switch (term) {
    case "today":
      return due === today;
    case "tomorrow":
      return due === addDays(today, 1);
    case "overdue":
      return due !== undefined && due < today;
    case "upcoming":
      return due !== undefined && due >= today;
    case "nodate":
    case "no date":
      return due === undefined;
    case "7 days":
    case "next 7 days":
      return due !== undefined && due >= today && due < addDays(today, 7);
    case "no deadline":
      return (task.deadline ?? "") === "";
    case "deadline":
      return (task.deadline ?? "") !== "";
    case "recurring":
      return task.is_recurring;
    case "completed":
      return task.completed;
    default:
      return undefined;
  }
}

function taskMatches(task: Task, context: Context, term: string): boolean {
  const { data } = context;
  const schedule = scheduleMatches(task, context, term);
  if (schedule !== undefined) return schedule;
  if (/^p[1-4]$/.test(term)) return task.priority.toLowerCase() === term;
  if (term.startsWith("#")) {
    const project = data.projects.find((item) => item.id === task.project_id);
    return project !== undefined && textContains(project.name, term.slice(1));
  }
  if (term.startsWith("@")) {
    return data.labels.some(
      (label) =>
        !label.is_deleted &&
        task.label_ids.includes(label.id) &&
        label.name.toLocaleLowerCase() === term.slice(1),
    );
  }
  if (term.startsWith("/")) {
    const section = data.sections.find((item) => item.id === task.section_id);
    return section !== undefined && textContains(section.name, term.slice(1));
  }
  return textContains(task.title, term) || textContains(task.description, term);
}

function matchTerm(raw: string): Filter {
  const term = raw.toLocaleLowerCase();
  const date = dateCondition.exec(term);
  if (date !== null) {
    const field = date[1] ?? "";
    const sense = date[2] ?? "";
    const expected = date[3]?.trim() ?? "";
    if (!isCivilDay(expected)) throw new Error("Enter a date as YYYY-MM-DD.");
    return {
      matches: (task, context) => {
        const value =
          field === "deadline"
            ? task.deadline
            : effectiveCivilDay(task, context.timeZone);
        return (
          value !== undefined &&
          (sense === "before" ? value < expected : value > expected)
        );
      },
      includesCompleted: false,
    };
  }
  if (term.includes(":") || ["@", "#", "/"].includes(term))
    throw new Error(`Unsupported condition: ${raw}`);
  const terms =
    namedConditions.has(term) || ["@", "#", "/"].includes(term.charAt(0))
      ? [term]
      : term.split(/\s+/);
  return {
    matches: (task, context) =>
      terms.every((word) => taskMatches(task, context, word)),
    includesCompleted: terms.includes("completed"),
  };
}

function combine(left: Filter, right: Filter, union: boolean): Filter {
  return {
    matches: union
      ? (task, context) =>
          left.matches(task, context) || right.matches(task, context)
      : (task, context) =>
          left.matches(task, context) && right.matches(task, context),
    includesCompleted: left.includesCompleted || right.includesCompleted,
  };
}

export function parseSavedFilter(query: string): Filter {
  if (query.trim() === "")
    return { matches: () => true, includesCompleted: false };
  const normalized = query
    .replaceAll(/\bAND\b/g, "&")
    .replaceAll(/\bOR\b/g, "|")
    .replaceAll(/\bNOT\b/g, "!")
    .replaceAll(/(?<=[^\s(&|!])\s+(?=[#@/])/g, " & ");
  const tokens = normalized
    .split(/([()!|&])/)
    .map((token) => token.trim())
    .filter(Boolean);
  let position = 0;
  const accept = (value: string) => {
    if (tokens[position] !== value) return false;
    position += 1;
    return true;
  };
  function primary(depth: number): Filter {
    if (depth > 64)
      throw new Error("This filter has too many nested conditions.");
    if (accept("!")) {
      const child = primary(depth + 1);
      return {
        matches: (task, context) => !child.matches(task, context),
        includesCompleted: child.includesCompleted,
      };
    }
    if (accept("(")) {
      const child = expression(depth + 1);
      if (!accept(")")) throw new Error("Close the group with ).");
      return child;
    }
    const term = tokens[position++];
    if (term === undefined || [")", "|", "&"].includes(term))
      throw new Error("Enter a condition, such as today or #Work.");
    return matchTerm(term);
  }
  function conjunction(depth: number): Filter {
    let current = primary(depth);
    while (accept("&")) current = combine(current, primary(depth), false);
    return current;
  }
  function expression(depth: number): Filter {
    let current = conjunction(depth);
    while (accept("|")) current = combine(current, conjunction(depth), true);
    return current;
  }
  const result = expression(0);
  if (position < tokens.length)
    throw new Error("Separate conditions with & or |.");
  return result;
}
