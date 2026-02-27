import type { NlpParseResult, Priority } from "../domain/types.ts";

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

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function toISODate(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveDate(word: string): string | undefined {
  const lower = word.toLowerCase();
  const today = new Date();

  if (lower === "today") {
    return toISODate(today);
  }
  if (lower === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }

  const dayIndex = DAY_NAMES.indexOf(lower);
  if (dayIndex !== -1) {
    const d = new Date(today);
    const currentDay = d.getDay();
    const daysAhead = (dayIndex - currentDay + 7) % 7 || 7;
    d.setDate(d.getDate() + daysAhead);
    return toISODate(d);
  }

  return undefined;
}

type ParseState = {
  due: string | undefined;
  priority: Priority | undefined;
  projects: string[];
  contexts: string[];
  tags: string[];
  titleParts: string[];
};

function classifyWord(word: string, state: ParseState): void {
  const priorityMatch = PRIORITY_MAP[word.toLowerCase()];
  if (priorityMatch !== undefined) {
    state.priority = priorityMatch;
    return;
  }

  if (word.startsWith("p:") && word.length > 2) {
    state.projects.push(word.slice(2));
    return;
  }

  if (word.startsWith("@") && word.length > 1) {
    state.contexts.push(word.slice(1));
    return;
  }

  if (word.startsWith("#") && word.length > 1) {
    state.tags.push(word.slice(1));
    return;
  }

  const resolved = resolveDate(word);
  if (resolved !== undefined) {
    state.due = resolved;
    return;
  }

  state.titleParts.push(word);
}

export function parseTaskInput(input: string): NlpParseResult {
  const words = input.split(/\s+/);
  const state: ParseState = {
    due: undefined,
    priority: undefined,
    projects: [],
    contexts: [],
    tags: [],
    titleParts: [],
  };

  let skipNext = false;

  for (let i = 0; i < words.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const word = words[i];
    if (word === undefined || word === "") continue;

    if (
      word.toLowerCase() === "next" &&
      words[i + 1]?.toLowerCase() === "week"
    ) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      state.due = toISODate(d);
      skipNext = true;
      continue;
    }

    classifyWord(word, state);
  }

  return {
    title: state.titleParts.join(" "),
    ...(state.due === undefined ? {} : { due: state.due }),
    ...(state.priority === undefined ? {} : { priority: state.priority }),
    ...(state.projects.length > 0 ? { projects: state.projects } : {}),
    ...(state.contexts.length > 0 ? { contexts: state.contexts } : {}),
    ...(state.tags.length > 0 ? { tags: state.tags } : {}),
  };
}
