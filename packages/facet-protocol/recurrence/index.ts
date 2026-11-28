import type { RecurrenceBasis, Task } from "../generated/index.ts";
import {
  type ByDaySpec,
  type ParsedRRule,
  parseCompactDate,
  parseRRule as parseRule,
} from "./rrule-parser.ts";

type RecurrenceMode = `${RecurrenceBasis}`;

export type NextOccurrenceInput = {
  rule: string;
  dueDate?: string | undefined;
  dueDatetime?: string | undefined;
  referenceDate?: Date | undefined;
  dueTimezone?: string | undefined;
  basis?: RecurrenceMode | undefined;
  completedAt?: Date | undefined;
};

export type NextOccurrenceResult =
  | { ended: true }
  | {
      ended: false;
      nextDate: Date;
      updatedRule: string;
    };

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(
  year: number,
  monthIndex: number,
  monthsToAdd: number,
): { year: number; month: number } {
  const total = year * 12 + monthIndex + monthsToAdd;
  return {
    year: Math.floor(total / 12),
    month: ((total % 12) + 12) % 12,
  };
}

function makeDateWithAnchorTime(
  anchor: Date,
  target: { year: number; month: number; day: number },
): Date {
  return new Date(
    Date.UTC(
      target.year,
      target.month,
      target.day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

function resolveMonthDaysInMonth(
  year: number,
  month: number,
  byMonthDay: number[],
): number[] {
  const maxDay = daysInUtcMonth(year, month);
  const resolved = new Set<number>();
  for (const spec of byMonthDay) {
    const day = spec > 0 ? spec : maxDay + 1 + spec;
    if (day >= 1 && day <= maxDay) {
      resolved.add(day);
    }
  }
  return [...resolved].sort((a, b) => a - b);
}

function collectWeekdayDays(
  year: number,
  month: number,
  weekday: number,
): number[] {
  const maxDay = daysInUtcMonth(year, month);
  const days: number[] = [];
  for (let day = 1; day <= maxDay; day += 1) {
    if (new Date(Date.UTC(year, month, day)).getUTCDay() === weekday) {
      days.push(day);
    }
  }
  return days;
}

function resolveByDaysInMonth(
  year: number,
  month: number,
  byDay: ByDaySpec[],
): number[] {
  const matching = new Set<number>();

  for (const spec of byDay) {
    const matchingForWeekday = collectWeekdayDays(year, month, spec.weekday);
    if (spec.ordinal === undefined) {
      for (const d of matchingForWeekday) {
        matching.add(d);
      }
      continue;
    }
    const idx =
      spec.ordinal > 0
        ? spec.ordinal - 1
        : matchingForWeekday.length + spec.ordinal;
    const picked = matchingForWeekday[idx];
    if (picked !== undefined) {
      matching.add(picked);
    }
  }

  return [...matching].sort((a, b) => a - b);
}

function stepDaily(anchor: Date, rule: ParsedRRule): Date {
  if (rule.byDay.length === 0) {
    return addUtcDays(anchor, rule.interval);
  }
  const allowedDays = new Set(rule.byDay.map((b) => b.weekday));
  for (let step = 1; step <= 400; step += 1) {
    const candidate = addUtcDays(anchor, step * rule.interval);
    if (allowedDays.has(candidate.getUTCDay())) {
      return candidate;
    }
  }
  return addUtcDays(anchor, rule.interval);
}

function stepWeekly(anchor: Date, rule: ParsedRRule): Date {
  if (rule.byDay.length === 0) {
    return addUtcDays(anchor, 7 * rule.interval);
  }
  const anchorMonOffset = (anchor.getUTCDay() + 6) % 7;
  const weekMonday = addUtcDays(anchor, -anchorMonOffset);
  const offsets = [...new Set(rule.byDay.map((b) => (b.weekday + 6) % 7))].sort(
    (a, b) => a - b,
  );

  const sameWeekNext = offsets.find((offset) => offset > anchorMonOffset);
  if (sameWeekNext !== undefined) {
    return addUtcDays(weekMonday, sameWeekNext);
  }

  const nextWeekMonday = addUtcDays(weekMonday, 7 * rule.interval);
  return addUtcDays(nextWeekMonday, offsets[0] ?? anchorMonOffset);
}

function stepMonthly(anchor: Date, rule: ParsedRRule): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  if (rule.byMonthDay.length > 0 || rule.byDay.length > 0) {
    const resolveDays = (y: number, m: number) =>
      rule.byMonthDay.length > 0
        ? resolveMonthDaysInMonth(y, m, rule.byMonthDay)
        : resolveByDaysInMonth(y, m, rule.byDay);

    const sameMonthDay = resolveDays(year, month).find((d) => d > day);
    if (sameMonthDay !== undefined) {
      return makeDateWithAnchorTime(anchor, {
        year,
        month,
        day: sameMonthDay,
      });
    }

    for (let step = 1; step <= 24; step += 1) {
      const target = addUtcMonths(year, month, step * rule.interval);
      const nextDays = resolveDays(target.year, target.month);
      if (nextDays[0] !== undefined) {
        return makeDateWithAnchorTime(anchor, {
          year: target.year,
          month: target.month,
          day: nextDays[0],
        });
      }
    }
  }

  const target = addUtcMonths(year, month, rule.interval);
  const clampedDay = Math.min(day, daysInUtcMonth(target.year, target.month));
  return makeDateWithAnchorTime(anchor, {
    year: target.year,
    month: target.month,
    day: clampedDay,
  });
}

function stepYearly(anchor: Date, rule: ParsedRRule): Date {
  const targetYear = anchor.getUTCFullYear() + rule.interval;
  const targetMonth = anchor.getUTCMonth();
  const resolvedDays =
    rule.byMonthDay.length > 0
      ? resolveMonthDaysInMonth(targetYear, targetMonth, rule.byMonthDay)
      : [];
  const day =
    resolvedDays[0] ??
    Math.min(anchor.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return makeDateWithAnchorTime(anchor, {
    year: targetYear,
    month: targetMonth,
    day,
  });
}

function resolveAnchorDate(
  input: NextOccurrenceInput,
  parsed: ParsedRRule,
): Date {
  if (input.dueDatetime !== undefined && input.dueDatetime !== "") {
    const dt = new Date(input.dueDatetime);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  if (input.dueDate !== undefined && input.dueDate !== "") {
    const d = parseCompactDate(input.dueDate, false);
    if (d !== undefined) {
      return d;
    }
  }
  if (parsed.dtstart !== undefined) {
    return parsed.dtstart;
  }
  const ref = input.referenceDate ?? new Date();
  return new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()),
  );
}

export function computeNextOccurrence(
  input: NextOccurrenceInput,
): NextOccurrenceResult {
  const parsed = parseRule(input.rule);
  if (parsed === null) {
    return { ended: true };
  }
  if (parsed.count !== undefined && parsed.count <= 1) {
    return { ended: true };
  }

  const zone = input.dueTimezone ?? "UTC";
  const timed = Boolean(input.dueDatetime);
  const original = resolveAnchorDate(input, parsed);
  let anchor = timed ? localClock(original, zone) : original;
  const completed =
    input.completedAt === undefined
      ? undefined
      : localClock(input.completedAt, zone);
  if (completed !== undefined && input.basis === "Completion") {
    anchor = makeDateWithAnchorTime(anchor, {
      year: completed.getUTCFullYear(),
      month: completed.getUTCMonth(),
      day: completed.getUTCDate(),
    });
  }
  let next = stepOccurrence(anchor, parsed);
  while (completed !== undefined && next <= completed) {
    const later = stepOccurrence(next, parsed);
    if (!(later > next)) return { ended: true };
    next = later;
  }
  const nextDate = timed ? resolveClock(next, zone) : next;

  if (
    !Number.isFinite(nextDate.getTime()) ||
    (parsed.until !== undefined && nextDate > parsed.until)
  ) {
    return { ended: true };
  }
  const updatedRule =
    parsed.count === undefined
      ? input.rule
      : input.rule.replace(/COUNT=\d+/i, `COUNT=${String(parsed.count - 1)}`);
  return { ended: false, nextDate, updatedRule };
}

// Arithmetic uses a UTC surrogate for the task's local wall clock.
const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function localClock(instant: Date, zone: string): Date {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .map(({ type, value }) => [type, Number(value)]),
  );
  return new Date(
    Date.UTC(
      Number(parts.get("year")),
      Number(parts.get("month")) - 1,
      Number(parts.get("day")),
      Number(parts.get("hour")),
      Number(parts.get("minute")),
      Number(parts.get("second")),
    ),
  );
}

function resolveClock(clock: Date, zone: string): Date {
  const target = clock.getTime();
  const candidates = [target - DAY_MS, target + DAY_MS].map((sample) => {
    const offset = localClock(new Date(sample), zone).getTime() - sample;
    return target - offset;
  });
  // When clocks overlap, prefer the earlier exact instant. For a skipped
  // wall time, use the later instant so the clock moves forward over the gap.
  const exact = candidates.filter(
    (candidate) => localClock(new Date(candidate), zone).getTime() === target,
  );
  return new Date(
    exact.length > 0 ? Math.min(...exact) : Math.max(...candidates),
  );
}

export function parseRRule(rule: string): ParsedRRule | null {
  return parseRule(rule);
}

function stepOccurrence(anchor: Date, parsed: ParsedRRule): Date {
  let nextDate: Date;
  switch (parsed.freq) {
    case "DAILY": {
      nextDate = stepDaily(anchor, parsed);
      break;
    }
    case "WEEKLY": {
      nextDate = stepWeekly(anchor, parsed);
      break;
    }
    case "MONTHLY": {
      nextDate = stepMonthly(anchor, parsed);
      break;
    }
    case "YEARLY": {
      nextDate = stepYearly(anchor, parsed);
      break;
    }
  }

  return nextDate;
}

function toUtcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export type TaskCompletion =
  | { kind: "completed"; completedAt: Date }
  | {
      kind: "advanced";
      recurrenceRule: string;
      dueDate?: Date;
      dueDatetime?: Date;
    };

type RecurringTask = Pick<
  Task,
  | "is_recurring"
  | "recurrence_rule"
  | "due_date"
  | "due_datetime"
  | "due_timezone"
> & {
  recurrence_basis?: RecurrenceMode;
};

export function taskCompletion(
  task: RecurringTask,
  completedAt: Date,
): TaskCompletion {
  if (
    !task.is_recurring ||
    task.recurrence_rule === undefined ||
    task.recurrence_rule === ""
  ) {
    return { kind: "completed", completedAt };
  }
  const next = computeNextOccurrence({
    rule: task.recurrence_rule,
    dueDate: task.due_date,
    dueDatetime: task.due_datetime,
    referenceDate: completedAt,
    completedAt,
    dueTimezone: task.due_timezone,
    basis: task.recurrence_basis,
  });
  if (next.ended) return { kind: "completed", completedAt };

  const hasDueDatetime =
    task.due_datetime !== undefined && task.due_datetime !== "";
  const hasDueDate = task.due_date !== undefined && task.due_date !== "";
  const advancement = {
    kind: "advanced",
    recurrenceRule: next.updatedRule,
  } as const;
  if (!hasDueDatetime)
    return { ...advancement, dueDate: toUtcDateOnly(next.nextDate) };
  return {
    ...advancement,
    dueDatetime: next.nextDate,
    ...(hasDueDate
      ? {
          dueDate: toUtcDateOnly(
            localClock(next.nextDate, task.due_timezone ?? "UTC"),
          ),
        }
      : {}),
  };
}
