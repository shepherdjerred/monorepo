import { Temporal } from "@js-temporal/polyfill";

/**
 * The one place the consoles turn numbers and times into text. Temporal does
 * the arithmetic; `Intl` does the display. Pacific time is the house zone.
 */

/** A moment: epoch milliseconds, a `Date`, or an ISO string with an offset. */
export type TimeInput = Date | number | string;

export const DISPLAY_ZONE = "America/Los_Angeles";

/** Under this, a moment reads "just now". */
const JUST_NOW_MS = 45_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Past 30 days relative time switches to calendar months. */
const MONTH_FROM_DAYS = 30;
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function toInstant(value: TimeInput): Temporal.Instant {
  if (typeof value === "string") return Temporal.Instant.from(value);
  const ms = typeof value === "number" ? value : value.getTime();
  if (!Number.isFinite(ms)) throw new RangeError(`Not a moment: ${String(ms)}`);
  return Temporal.Instant.fromEpochMilliseconds(ms);
}

/** The ISO 8601 form for a `<time dateTime>` attribute. */
export function toIso(value: TimeInput): string {
  return toInstant(value).toString();
}

export function toEpochMs(value: TimeInput): number {
  return toInstant(value).epochMilliseconds;
}

const countFormat = new Intl.NumberFormat("en-US");

/** `12,345`: grouped with commas, never abbreviated. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Not a count: ${String(value)}`);
  }
  return countFormat.format(value);
}

/** A ratio from 0 to 1 as a percentage: `formatPercent(0.9712, 1)` is `97.1%`. */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  if (!Number.isFinite(ratio)) {
    throw new RangeError(`Not a ratio: ${String(ratio)}`);
  }
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

function bytesDecimals(scaled: number): number {
  if (scaled >= 100) return 0;
  return scaled >= 10 ? 1 : 2;
}

/**
 * Binary units (KiB, MiB, GiB, TiB) with decimals that shrink as the number
 * grows: `0 B`, `512 B`, `1.5 KiB`, `14.2 MiB`, `118 GiB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Not a byte count: ${String(bytes)}`);
  }
  let unit = 0;
  let scaled = bytes;
  while (scaled >= 1024 && unit < BINARY_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  let digits = unit === 0 ? 0 : bytesDecimals(scaled);
  // 1023.99 KiB rounds to 1,024; show it as 1 MiB instead.
  if (
    unit < BINARY_UNITS.length - 1 &&
    Number(scaled.toFixed(digits)) >= 1024
  ) {
    scaled /= 1024;
    unit += 1;
    digits = bytesDecimals(scaled);
  }
  const text = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(scaled);
  return `${text} ${BINARY_UNITS[unit] ?? "B"}`;
}

/**
 * A span of time: `850ms`, `45s`, `12m 5s`, `2h 14m`, `3d 4h`. At most two
 * units, the largest two that are not zero.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`Not a duration: ${String(ms)}`);
  }
  const whole = Math.floor(ms);
  if (whole < 1000) return `${String(whole)}ms`;
  const parts = Temporal.Duration.from({ milliseconds: whole }).round({
    largestUnit: "day",
    smallestUnit: "second",
    roundingMode: "floor",
  });
  const units: readonly (readonly [number, string])[] = [
    [parts.days, "d"],
    [parts.hours, "h"],
    [parts.minutes, "m"],
    [parts.seconds, "s"],
  ];
  const first = units.findIndex(([amount]) => amount > 0);
  const shown = units.slice(first, first + 2).filter(([amount]) => amount > 0);
  return shown
    .map(([amount, suffix]) => `${String(amount)}${suffix}`)
    .join(" ");
}

/** The ISO 8601 duration (`PT2H14M`) for a `<time dateTime>` attribute. */
export function durationIso(ms: number): string {
  return Temporal.Duration.from({ milliseconds: Math.floor(ms) })
    .round({
      largestUnit: "hour",
      smallestUnit: "second",
      roundingMode: "floor",
    })
    .toString();
}

function relativeSpan(
  span: number,
  a: Temporal.Instant,
  b: Temporal.Instant,
): string {
  if (span < MINUTE_MS) return `${String(Math.floor(span / 1000))}s`;
  if (span < HOUR_MS) return `${String(Math.floor(span / MINUTE_MS))}m`;
  if (span < DAY_MS) return `${String(Math.floor(span / HOUR_MS))}h`;
  if (span < MONTH_FROM_DAYS * DAY_MS) {
    return `${String(Math.floor(span / DAY_MS))}d`;
  }
  const [early, late] = Temporal.Instant.compare(a, b) < 0 ? [a, b] : [b, a];
  const calendar = early
    .toZonedDateTimeISO(DISPLAY_ZONE)
    .until(late.toZonedDateTimeISO(DISPLAY_ZONE), { largestUnit: "year" });
  return calendar.years >= 1
    ? `${String(calendar.years)}y`
    : `${String(Math.max(calendar.months, 1))}mo`;
}

/**
 * How long ago `value` was, as of `now`: `just now` under 45 seconds, then
 * `45s ago`, `5m ago`, `3h ago`, `4d ago`, `2mo ago`, `1y ago`. A moment in
 * the future reads `in 5m`.
 */
export function formatRelative(value: TimeInput, now: TimeInput): string {
  const then = toInstant(value);
  const current = toInstant(now);
  const delta = current.epochMilliseconds - then.epochMilliseconds;
  const span = Math.abs(delta);
  if (span < JUST_NOW_MS) return "just now";
  const text = relativeSpan(span, then, current);
  return delta < 0 ? `in ${text}` : `${text} ago`;
}

export type ExactPrecision = "day" | "minute" | "second";

export type ExactOptions = {
  /** `minute` by default: `Nov 26, 14:02 PT`. */
  readonly precision?: ExactPrecision;
  /** Add the year; use it for moments outside the current year. */
  readonly year?: boolean;
};

/** The exact moment in Pacific time: `Nov 26, 14:02 PT` (24-hour). */
export function formatExact(
  value: TimeInput,
  { precision = "minute", year = false }: ExactOptions = {},
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toEpochMs(value));
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("month")} ${get("day")}`;
  if (precision === "day") return `${date}, ${get("year")}`;
  const clock =
    precision === "second"
      ? `${get("hour")}:${get("minute")}:${get("second")}`
      : `${get("hour")}:${get("minute")}`;
  return `${date}, ${year ? `${get("year")}, ` : ""}${clock} PT`;
}
