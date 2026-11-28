import { z } from "zod";

const CIVIL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CivilDay = string;

type PlainDate = {
  toString: () => string;
  add: (duration: { days: number }) => PlainDate;
};

type TemporalApi = {
  PlainDate: {
    from: (value: string) => PlainDate;
    compare: (left: PlainDate, right: PlainDate) => number;
  };
  Instant: {
    from: (value: string) => {
      toZonedDateTimeISO: (timeZone: string) => {
        toPlainDate: () => PlainDate;
      };
    };
  };
};

function isTemporalShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const plainDate: unknown = Reflect.get(value, "PlainDate");
  const instant: unknown = Reflect.get(value, "Instant");
  if (typeof plainDate !== "object" || plainDate === null) return false;
  if (typeof instant !== "object" || instant === null) return false;
  if (typeof Reflect.get(plainDate, "from") !== "function") return false;
  if (typeof Reflect.get(plainDate, "compare") !== "function") return false;
  if (typeof Reflect.get(instant, "from") !== "function") return false;
  return true;
}

const TemporalSchema = z.custom<TemporalApi>((value) => isTemporalShape(value));

function temporalApi(): TemporalApi | undefined {
  const parsed = TemporalSchema.safeParse(Reflect.get(globalThis, "Temporal"));
  return parsed.success ? parsed.data : undefined;
}

export function isCivilDay(value: string): boolean {
  const match = CIVIL_DAY.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function requireCivilDay(day: CivilDay): [number, number, number] {
  const match = CIVIL_DAY.exec(day);
  if (match === null) throw new Error(`Not a civil day: ${day}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatUtc(year: number, monthIndex: number, day: number): CivilDay {
  const probe = new Date(Date.UTC(year, monthIndex, day));
  const month = (probe.getUTCMonth() + 1).toString().padStart(2, "0");
  const date = probe.getUTCDate().toString().padStart(2, "0");
  return `${probe.getUTCFullYear().toString()}-${month}-${date}`;
}

function addDaysFallback(day: CivilDay, days: number): CivilDay {
  const [year, month, date] = requireCivilDay(day);
  return formatUtc(year, month - 1, date + days);
}

function todayFallback(timeZone: string, now: Date): CivilDay {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (!isCivilDay(formatted)) {
    throw new Error(`Could not format a civil day in ${timeZone}`);
  }
  return formatted;
}

export function today(timeZone: string, now = new Date()): CivilDay {
  const temporal = temporalApi();
  return temporal === undefined
    ? todayFallback(timeZone, now)
    : temporal.Instant.from(now.toISOString())
        .toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toString();
}

export function addDays(day: CivilDay, days: number): CivilDay {
  const temporal = temporalApi();
  return temporal === undefined
    ? addDaysFallback(day, days)
    : temporal.PlainDate.from(day).add({ days }).toString();
}

export function compareCivilDays(left: CivilDay, right: CivilDay): number {
  const temporal = temporalApi();
  if (temporal !== undefined) {
    return temporal.PlainDate.compare(
      temporal.PlainDate.from(left),
      temporal.PlainDate.from(right),
    );
  }
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function civilDayOfInstant(iso: string, timeZone: string): CivilDay {
  const temporal = temporalApi();
  return temporal === undefined
    ? todayFallback(timeZone, new Date(iso))
    : temporal.Instant.from(iso)
        .toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toString();
}

export function effectiveCivilDay(
  task: { due_date?: string | undefined; due_datetime?: string | undefined },
  timeZone: string,
): CivilDay | undefined {
  if (task.due_datetime !== undefined && task.due_datetime !== "") {
    return civilDayOfInstant(task.due_datetime, timeZone);
  }
  if (task.due_date !== undefined && task.due_date.length >= 10) {
    const prefix = task.due_date.slice(0, 10);
    if (isCivilDay(prefix)) return prefix;
  }
  return undefined;
}

function utcDate(day: CivilDay): Date {
  const [year, month, date] = requireCivilDay(day);
  return new Date(Date.UTC(year, month - 1, date));
}

function formatCivil(
  day: CivilDay,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(utcDate(day));
}

export function formatMonthDay(day: CivilDay): string {
  return formatCivil(day, { month: "short", day: "numeric" });
}

export function formatWeekdayLong(day: CivilDay): string {
  return formatCivil(day, { weekday: "long" });
}

export function formatWeekdayShort(day: CivilDay): string {
  return formatCivil(day, { weekday: "short" });
}

export function dayNumber(day: CivilDay): string {
  return requireCivilDay(day)[2].toString();
}

export function dayHeading(day: CivilDay, current: CivilDay): string {
  const label = formatMonthDay(day);
  if (day === current) return `Today · ${label}`;
  return day === addDays(current, 1)
    ? `Tomorrow · ${label}`
    : `${formatWeekdayLong(day)} · ${label}`;
}
