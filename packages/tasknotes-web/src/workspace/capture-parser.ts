import {
  Priority,
  RecurrenceBasis,
  type TaskAddArgs,
} from "@shepherdjerred/facet-protocol";
import { addDays, isCivilDay, type CivilDay } from "./civil-day.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import { isoForWallTime } from "./task-schedule.ts";
import {
  activeLabels,
  activeProjects,
  sectionsIn,
  type Destination,
} from "./workspace.ts";

export type CaptureContext = {
  data: WorkspaceData;
  destination: Destination;
  today: CivilDay;
  timeZone: string;
  upcomingDay?: CivilDay;
  sectionId?: string;
};

export type ParsedCapture = {
  args: TaskAddArgs;
  newLabels: string[];
  phrases: string[];
  unresolvedProject?: string;
};

const weekdays = [
  ["SU", "sunday", "sun"],
  ["MO", "monday", "mon"],
  ["TU", "tuesday", "tue", "tues"],
  ["WE", "wednesday", "wed"],
  ["TH", "thursday", "thu", "thur", "thurs"],
  ["FR", "friday", "fri"],
  ["SA", "saturday", "sat"],
];
const weekdayPattern = weekdays.flatMap((day) => day.slice(1)).join("|");

function followingWeekday(
  today: CivilDay,
  index: number,
  next: boolean,
): CivilDay {
  const from = new Date(`${today}T12:00:00Z`).getUTCDay();
  const delta = (index - from + 7) % 7;
  return addDays(today, delta + (delta === 0 || next ? 7 : 0));
}

function datePhrase(phrase: string, today: CivilDay): CivilDay | undefined {
  const text = phrase.toLowerCase();
  if (isCivilDay(text)) return text;
  if (text === "today" || text === "tonight") return today;
  if (text === "tomorrow" || text === "tmr") return addDays(today, 1);
  if (text === "next week") return followingWeekday(today, 1, false);
  if (text === "this weekend") return followingWeekday(today, 6, false);
  const name = text.replace(/^next\s+/, "");
  const index = weekdays.findIndex((day) => day.slice(1).includes(name));
  return index === -1
    ? undefined
    : followingWeekday(today, index, name !== text);
}

function parseTime(
  hourText: string,
  minutes: string | undefined,
  meridiem?: string,
): string | undefined {
  let hour = Number(hourText);
  const minute = Number(minutes ?? 0);
  if (minute > 59 || hour > 23) return undefined;
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const recurringPhrases: readonly (readonly [RegExp, string])[] = [
  [
    /(?:^|\s)(every!?\s+(?:weekday|workday)s?)(?=\s|$)/i,
    "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  ],
  [/(?:^|\s)(every!?\s+weekend)(?=\s|$)/i, "FREQ=WEEKLY;BYDAY=SA,SU"],
  [/(?:^|\s)(every!?\s+day|daily)(?=\s|$)/i, "FREQ=DAILY"],
  [/(?:^|\s)(every!?\s+week|weekly)(?=\s|$)/i, "FREQ=WEEKLY"],
  [/(?:^|\s)(every!?\s+month|monthly)(?=\s|$)/i, "FREQ=MONTHLY"],
  [/(?:^|\s)(every!?\s+year|yearly|annually)(?=\s|$)/i, "FREQ=YEARLY"],
];

function recurrence(
  text: string,
): { match: RegExpMatchArray; rule: string } | undefined {
  for (const [pattern, rule] of recurringPhrases) {
    const match = text.match(pattern);
    if (match !== null) return { match, rule };
  }
  const interval =
    /(?:^|\s)(every!?\s+(\d+)\s+(day|week|month|year)s?)(?=\s|$)/i.exec(text);
  if (interval !== null) {
    const count = Number(interval[2]);
    const frequencies: Record<string, string> = {
      day: "DAILY",
      week: "WEEKLY",
      month: "MONTHLY",
      year: "YEARLY",
    };
    const freq = frequencies[interval[3]?.toLowerCase() ?? ""];
    if (freq !== undefined && count > 0 && Number.isSafeInteger(count)) {
      return {
        match: interval,
        rule: `FREQ=${freq}${count === 1 ? "" : `;INTERVAL=${count.toString()}`}`,
      };
    }
  }
  const list = new RegExp(
    String.raw`(?:^|\s)(every!?\s+((?:${weekdayPattern})(?:(?:\s*,\s*|\s+and\s+|\s+)(?:${weekdayPattern}))*))(?=\s|$)`,
    "i",
  ).exec(text);
  if (list === null) return undefined;
  const names = list[2]?.toLowerCase().split(/\W+/) ?? [];
  const codes = new Set(
    names.flatMap(
      (name) =>
        weekdays.find((day) => day.slice(1).includes(name))?.slice(0, 1) ?? [],
    ),
  );
  return { match: list, rule: `FREQ=WEEKLY;BYDAY=${[...codes].join(",")}` };
}

type CaptureText = ReturnType<typeof captureText>;

function captureText(raw: string, literal: ReadonlySet<string>) {
  let source = raw;
  const phrases: string[] = [];
  const removed: { start: number; end: number }[] = [];

  return {
    current: () => source,
    phrases,
    take(match: RegExpMatchArray) {
      const phrase = match[0].trim();
      if (phrase === "" || match.index === undefined) return false;
      const start = match.index + match[0].indexOf(phrase);
      const end = start + phrase.length;
      source =
        source.slice(0, start) + "·".repeat(phrase.length) + source.slice(end);
      if (literal.has(phrase)) return false;
      phrases.push(phrase);
      removed.push({ start, end });
      return true;
    },
    title() {
      let title = raw;
      for (const { start, end } of removed.sort(
        (left, right) => right.start - left.start,
      )) {
        title = title.slice(0, start) + " " + title.slice(end);
      }
      return title.trim().replaceAll(/\s+/g, " ");
    },
  };
}

function captureProject(
  text: CaptureText,
  args: TaskAddArgs,
  data: WorkspaceData,
): string | undefined {
  const token = /(?:^|\s)#(?:"([^"]+)"|([\w-]+))(?:\/([\w-]+))?(?=\s|$)/.exec(
    text.current(),
  );
  if (token === null || !text.take(token)) return undefined;
  const name = token[1] ?? token[2] ?? "";
  const project = activeProjects(data.projects).find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (project === undefined) return name;
  args.project_id = project.id;
  delete args.section_id;
  const nameOfSection = token[3]?.toLowerCase();
  const section = sectionsIn(data, project.id).find(
    (candidate) => candidate.name.toLowerCase() === nameOfSection,
  );
  if (section !== undefined) args.section_id = section.id;
  return undefined;
}

function captureLabels(
  text: CaptureText,
  args: TaskAddArgs,
  context: CaptureContext,
): string[] {
  const labels = activeLabels(context.data.labels);
  const newLabels = new Map<string, string>();
  const matched = new Set<string>();
  if (context.destination.kind === "label") matched.add(context.destination.id);
  for (const token of text
    .current()
    .matchAll(/(?:^|\s)[@%]([\w-]+)(?=\s|$)/g)) {
    const name = token[1];
    if (name === undefined || !text.take(token)) continue;
    const lower = name.toLowerCase();
    const existing = labels.find((label) => label.name.toLowerCase() === lower);
    if (existing === undefined) newLabels.set(lower, name);
    else matched.add(existing.id);
  }
  if (matched.size > 0) args.label_ids = [...matched];
  return [...newLabels.values()];
}

function captureRepeat(text: CaptureText, args: TaskAddArgs) {
  const repeat = recurrence(text.current());
  if (repeat === undefined || !text.take(repeat.match)) return;
  args.recurrence_rule = repeat.rule;
  args.recurrence_basis = repeat.match[0]
    .trimStart()
    .toLowerCase()
    .startsWith("every!")
    ? RecurrenceBasis.Completion
    : RecurrenceBasis.Scheduled;
}

function captureTime(text: CaptureText): string | undefined {
  const match =
    /(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$)|(?:^|\s)at\s+([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/i.exec(
      text.current(),
    );
  const hours = match?.[1] ?? match?.[4];
  if (match === null || hours === undefined) return undefined;
  const parsed = parseTime(hours, match[2] ?? match[5], match[3]);
  return parsed !== undefined && text.take(match) ? parsed : undefined;
}

const datePatterns = [
  /(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/,
  /(?:^|\s)(today|tonight)(?=\s|$)/i,
  /(?:^|\s)(tomorrow|tmr)(?=\s|$)/i,
  /(?:^|\s)(next week)(?=\s|$)/i,
  /(?:^|\s)(this weekend)(?=\s|$)/i,
  new RegExp(
    String.raw`(?:^|\s)((?:next\s+)?(?:${weekdayPattern}))(?=\s|$)`,
    "i",
  ),
];

function captureDate(
  text: CaptureText,
  today: CivilDay,
): { day: CivilDay; phrase: string } | undefined {
  for (const pattern of datePatterns) {
    const match = pattern.exec(text.current());
    const phrase = match?.[1];
    if (phrase === undefined || match === null) continue;
    const day = datePhrase(phrase, today);
    if (day !== undefined && text.take(match)) return { day, phrase };
  }
  return undefined;
}

function applySchedule(
  text: CaptureText,
  args: TaskAddArgs,
  context: CaptureContext,
) {
  const deadline = /\{([^{}]+)\}/.exec(text.current());
  const deadlineDay = datePhrase(deadline?.[1]?.trim() ?? "", context.today);
  if (deadline !== null && deadlineDay !== undefined && text.take(deadline))
    args.deadline = deadlineDay;
  captureRepeat(text, args);
  const time = captureTime(text);
  const date = captureDate(text, context.today);
  if (date !== undefined) args.due_string = date.phrase;
  const defaultDay =
    context.destination.kind === "section" &&
    context.destination.section === "today"
      ? context.today
      : context.upcomingDay;
  const day =
    date?.day ??
    defaultDay ??
    (time === undefined && args.recurrence_rule === undefined
      ? undefined
      : context.today);
  if (day === undefined) return;
  args.due_date = day;
  args.due_timezone = context.timeZone;
  if (time !== undefined)
    args.due_datetime = isoForWallTime(day, time, context.timeZone);
}

export function parseCapture(
  raw: string,
  context: CaptureContext,
  literal: ReadonlySet<string> = new Set(),
): ParsedCapture {
  const { destination, data } = context;
  const text = captureText(raw, literal);
  const args: TaskAddArgs = {
    title: "",
    project_id:
      destination.kind === "project"
        ? destination.id
        : (activeProjects(data.projects).find((project) => project.is_inbox)
            ?.id ?? ""),
    priority: Priority.P4,
  };
  if (context.sectionId !== undefined && destination.kind === "project")
    args.section_id = context.sectionId;
  const unresolvedProject = captureProject(text, args, data);
  const newLabels = captureLabels(text, args, context);
  const priority = /(?:^|\s)(?:p|!)([1-4])(?=\s|$)/i.exec(text.current());
  if (priority !== null && text.take(priority)) {
    args.priority =
      [Priority.P1, Priority.P2, Priority.P3, Priority.P4][
        Number(priority[1]) - 1
      ] ?? Priority.P4;
  }
  applySchedule(text, args, context);
  args.title = text.title();
  const result = { args, phrases: text.phrases, newLabels };
  return unresolvedProject === undefined
    ? result
    : { ...result, unresolvedProject };
}
