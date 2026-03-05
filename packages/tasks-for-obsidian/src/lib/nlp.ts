import type { Priority } from "../domain/priority";
import type { NlpParseResult } from "../domain/types";

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

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseTaskInput(input: string): NlpParseResult {
  const words = input.split(/\s+/);
  const titleParts: string[] = [];
  let due: string | undefined;
  let priority: Priority | undefined;
  const projects: string[] = [];
  const contexts: string[] = [];
  const tags: string[] = [];
  let skipNext = false;

  for (let i = 0; i < words.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const word = words[i];
    if (!word) continue;

    // "next week" as a two-word date phrase
    if (
      word.toLowerCase() === "next" &&
      words[i + 1]?.toLowerCase() === "week"
    ) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      due = toISODate(d);
      skipNext = true;
      continue;
    }

    // Priority: !high, !1, etc.
    const priorityMatch = PRIORITY_MAP[word.toLowerCase()];
    if (priorityMatch) {
      priority = priorityMatch;
      continue;
    }

    // Project: p:ProjectName
    if (word.startsWith("p:") && word.length > 2) {
      projects.push(word.slice(2));
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

    // Date words
    const resolved = resolveDate(word);
    if (resolved) {
      due = resolved;
      continue;
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
  };
}
