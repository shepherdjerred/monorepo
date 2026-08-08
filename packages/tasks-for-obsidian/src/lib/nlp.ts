import type { Priority } from "../domain/priority";
import type { NlpParseResult } from "../domain/types";
import { nextMonday, nextSaturday, toISODate } from "./dates";

const PRIORITY_MAP: Record<string, Priority> = {
  "!highest": "highest",
  "!high": "high",
  "!medium": "medium",
  "!low": "low",
  "!none": "none",
  "!1": "highest",
  "!2": "high",
  "!3": "medium",
  "!4": "low",
};

const TASK_INPUT_TOKEN_PATTERN = /p:"(?:\\.|[^"\\])*"|\S+/g;

export type TaskInputToken = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export function tokenizeTaskInput(input: string): TaskInputToken[] {
  const tokens: TaskInputToken[] = [];
  for (const match of input.matchAll(TASK_INPUT_TOKEN_PATTERN)) {
    const text = match[0];
    tokens.push({
      text,
      start: match.index,
      end: match.index + text.length,
    });
  }
  return tokens;
}

export function projectNameFromInputToken(token: string): string | undefined {
  if (!token.startsWith("p:")) return undefined;
  const raw = token.slice(2);
  if (!raw.startsWith('"')) return nonEmptyProjectName(raw);
  if (!raw.endsWith('"') || raw.length < 2) return undefined;

  let decoded = "";
  const quoted = raw.slice(1, -1);
  for (let index = 0; index < quoted.length; index += 1) {
    const character = quoted[index];
    if (character === undefined) {
      throw new Error("Quoted project token index is out of bounds");
    }
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = quoted[index + 1];
    if (escaped !== "\\" && escaped !== '"') return undefined;
    decoded += escaped;
    index += 1;
  }
  return nonEmptyProjectName(decoded);
}

export function projectInputToken(name: string): string {
  const project = nonEmptyProjectName(name);
  if (project === undefined) {
    throw new Error("Project name must not be empty");
  }
  if (!/[\s"\\]/.test(project)) return `p:${project}`;
  let escaped = "";
  for (const character of project) {
    if (character === "\\" || character === '"') escaped += "\\";
    escaped += character;
  }
  return `p:"${escaped}"`;
}

function nonEmptyProjectName(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const RRULE_DAY_NAMES: Readonly<Record<string, string>> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};

const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseDayNumber(word: string): number | undefined {
  if (!/^\d{1,2}(?:st|nd|rd|th)?$/.test(word)) return undefined;
  const n = Number(word.replace(/(?:st|nd|rd|th)$/, ""));
  return n >= 1 && n <= 31 ? n : undefined;
}

/** A month-day pair as the NEXT occurrence: this year, or next year if past. */
function resolveMonthDay(month: number, day: number, today: Date): string {
  const thisYear = new Date(today.getFullYear(), month, day);
  // Reject overflow (e.g. "feb 30" rolling into March).
  if (thisYear.getMonth() !== month) return "";
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  if (thisYear.getTime() >= startOfToday.getTime()) {
    return toISODate(thisYear);
  }
  const nextYear = new Date(today.getFullYear() + 1, month, day);
  return nextYear.getMonth() === month ? toISODate(nextYear) : "";
}

function resolveSingleWord(word: string, today: Date): string | undefined {
  const lower = word.toLowerCase();

  if (lower === "today") return toISODate(today);
  if (lower === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }

  const dayIndex = DAY_NAMES.indexOf(lower);
  if (dayIndex !== -1) {
    const d = new Date(today);
    const daysAhead = (dayIndex - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysAhead);
    return toISODate(d);
  }

  return undefined;
}

type PhraseMatch = { due: string; consumed: number };
type RecurrencePhraseMatch = { recurrence: string; consumed: number };

type WordAt = (offset: number) => string;

/** "end of month" / "this weekend" / "next week" / "next month" */
function matchKeywordPhrase(w: WordAt, today: Date): PhraseMatch | undefined {
  if (w(0) === "end" && w(1) === "of" && w(2) === "month") {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { due: toISODate(d), consumed: 3 };
  }
  if (w(0) === "this" && w(1) === "weekend") {
    return { due: nextSaturday(today), consumed: 2 };
  }
  // "next week" → next Monday (Todoist semantics, not +7 days)
  if (w(0) === "next" && w(1) === "week") {
    return { due: nextMonday(today), consumed: 2 };
  }
  // "next month" → same day one month later (clamped to month length)
  if (w(0) === "next" && w(1) === "month") {
    const lastOfNext = new Date(
      today.getFullYear(),
      today.getMonth() + 2,
      0,
    ).getDate();
    const d = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      Math.min(today.getDate(), lastOfNext),
    );
    return { due: toISODate(d), consumed: 2 };
  }
  return undefined;
}

/** "in N days" / "in N weeks" */
function matchInPhrase(w: WordAt, today: Date): PhraseMatch | undefined {
  if (w(0) !== "in") return undefined;
  const n = Number(w(1));
  if (!Number.isInteger(n) || n <= 0) return undefined;
  const unit = w(2);
  const factor =
    unit === "day" || unit === "days"
      ? 1
      : unit === "week" || unit === "weeks"
        ? 7
        : undefined;
  if (factor === undefined) return undefined;
  const d = new Date(today);
  d.setDate(d.getDate() + n * factor);
  return { due: toISODate(d), consumed: 3 };
}

/** "jan 27" / "27 jan" → next occurrence of that month-day */
function matchMonthDayPhrase(w: WordAt, today: Date): PhraseMatch | undefined {
  const monthFirst = MONTH_NAMES[w(0)];
  if (monthFirst !== undefined) {
    const day = parseDayNumber(w(1));
    if (day !== undefined) {
      const due = resolveMonthDay(monthFirst, day, today);
      if (due) return { due, consumed: 2 };
    }
  }
  const dayFirst = parseDayNumber(w(0));
  const monthSecond = MONTH_NAMES[w(1)];
  if (dayFirst !== undefined && monthSecond !== undefined) {
    const due = resolveMonthDay(monthSecond, dayFirst, today);
    if (due) return { due, consumed: 2 };
  }
  return undefined;
}

/**
 * Match a date phrase starting at `words[i]`. Longer phrases are tried
 * first so "end of month" wins over any shorter reading.
 */
function matchDatePhrase(
  words: string[],
  i: number,
  today: Date,
): PhraseMatch | undefined {
  const w: WordAt = (offset) => words[i + offset]?.toLowerCase() ?? "";

  const phrase =
    matchKeywordPhrase(w, today) ??
    matchInPhrase(w, today) ??
    matchMonthDayPhrase(w, today);
  if (phrase) return phrase;

  // Single words: today / tomorrow / weekday names
  const single = words[i];
  if (single !== undefined) {
    const due = resolveSingleWord(single, today);
    if (due) return { due, consumed: 1 };
  }

  return undefined;
}

function matchRecurrencePhrase(
  words: readonly string[],
  index: number,
): RecurrencePhraseMatch | undefined {
  if (words[index]?.toLowerCase() !== "every") return undefined;
  const cadence = words[index + 1]?.toLowerCase();
  if (cadence === undefined) return undefined;

  switch (cadence) {
    case "day":
    case "daily":
      return { recurrence: "FREQ=DAILY", consumed: 2 };
    case "weekday":
    case "weekdays":
      return {
        recurrence: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        consumed: 2,
      };
    case "week":
    case "weekly":
      return { recurrence: "FREQ=WEEKLY", consumed: 2 };
    case "month":
    case "monthly":
      return { recurrence: "FREQ=MONTHLY", consumed: 2 };
    case "year":
    case "yearly":
    case "annually":
      return { recurrence: "FREQ=YEARLY", consumed: 2 };
    default: {
      const byDay = RRULE_DAY_NAMES[cadence];
      return byDay === undefined
        ? undefined
        : { recurrence: `FREQ=WEEKLY;BYDAY=${byDay}`, consumed: 2 };
    }
  }
}

function matchUnsetRecurrencePhrase(
  recurrence: string | undefined,
  words: readonly string[],
  index: number,
): RecurrencePhraseMatch | undefined {
  return recurrence === undefined
    ? matchRecurrencePhrase(words, index)
    : undefined;
}

export function parseTaskInput(
  input: string,
  now = new Date(),
): NlpParseResult {
  const words = tokenizeTaskInput(input).map((token) => token.text);
  const titleParts: string[] = [];
  let due: string | undefined;
  let recurrence: string | undefined;
  let priority: Priority | undefined;
  const projects: string[] = [];
  const contexts: string[] = [];
  const tags: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;

    // Priority: !high, !1, etc.
    const priorityMatch = PRIORITY_MAP[word.toLowerCase()];
    if (priorityMatch) {
      priority = priorityMatch;
      continue;
    }

    // Project: p:ProjectName or p:"Multiword Project"
    const project = projectNameFromInputToken(word);
    if (project !== undefined) {
      projects.push(project);
      continue;
    }

    // Context: @context
    if (word.startsWith("@") && word.length > 1) {
      contexts.push(word.slice(1));
      continue;
    }

    // Tag: #tag
    if (word.startsWith("#") && word.length > 1) {
      tags.push(word.slice(1));
      continue;
    }

    // Recurrence phrases (first match wins; later phrases stay in the title)
    const recurrenceMatch = matchUnsetRecurrencePhrase(recurrence, words, i);
    if (recurrenceMatch !== undefined) {
      recurrence = recurrenceMatch.recurrence;
      i += recurrenceMatch.consumed - 1;
      continue;
    }

    // Date phrases (first match wins; later date words stay in the title)
    if (due === undefined) {
      const match = matchDatePhrase(words, i, now);
      if (match) {
        due = match.due;
        i += match.consumed - 1;
        continue;
      }
    }

    titleParts.push(word);
  }

  return {
    title: titleParts.join(" "),
    ...(due ? { due } : {}),
    ...(priority ? { priority } : {}),
    ...(projects.length > 0 ? { projects } : {}),
    ...(contexts.length > 0 ? { contexts } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(recurrence ? { recurrence } : {}),
  };
}
