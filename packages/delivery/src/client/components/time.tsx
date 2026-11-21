import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const subscribers = new Set<() => void>();
let now = Date.now();
let ticker: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  subscribers.add(listener);
  ticker ??= setInterval(() => {
    now = Date.now();
    for (const subscriber of subscribers) subscriber();
  }, TICK_MS);
  return () => {
    subscribers.delete(listener);
    if (ticker !== undefined && subscribers.size === 0) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/** A clock shared by every relative time on the page. */
export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
/**
 * The app's one absolute format: the reader's local date and a 24-hour
 * clock, to the minute or, where the order of nearby moments matters, to the
 * second.
 */
const exactFormats = {
  minute: new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }),
  second: new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    hourCycle: "h23",
  }),
} as const;
const clockFormat = new Intl.DateTimeFormat(undefined, {
  timeStyle: "medium",
  hourCycle: "h23",
});

export type TimePrecision = keyof typeof exactFormats;

/** A moment in the app's one absolute format, in the reader's time zone. */
export function exactTime(iso: string, precision: TimePrecision = "minute") {
  return exactFormats[precision].format(new Date(iso));
}

/**
 * A moment as a clock reading to the second, so rows a minute apart still
 * sort by eye; a moment on another local day than `at` keeps its date.
 */
export function clockTime(iso: string, at: number) {
  const date = new Date(iso);
  return date.toDateString() === new Date(at).toDateString()
    ? clockFormat.format(date)
    : exactFormats.second.format(date);
}
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(iso: string, at: number) {
  const delta = Date.parse(iso) - at;
  for (const [unit, size] of UNITS)
    if (Math.abs(delta) >= size)
      return relative.format(Math.round(delta / size), unit);
  return "just now";
}

export function duration(startIso: string, endIso: string | null, at: number) {
  const end = endIso === null ? at : Date.parse(endIso);
  const seconds = Math.max(0, Math.round((end - Date.parse(startIso)) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${String(minutes)}m ${String(seconds % 60)}s`
    : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

/**
 * How long ago (or until) a moment is, with the exact moment in `title`. A
 * list whose rows are ordered by reading them passes `clock` to show the
 * clock reading inline as well, because a touch screen cannot hover a title.
 */
export function RelativeTime({
  value,
  clock = false,
}: {
  value: string;
  clock?: boolean;
}) {
  const at = useNow();
  return (
    <time dateTime={value} title={exactTime(value, "second")}>
      {clock && (
        <span className="clock">
          {clockTime(value, at)}
          <span aria-hidden="true"> · </span>
        </span>
      )}
      {relativeTime(value, at)}
    </time>
  );
}

/**
 * A moment people act on by its date (an expiry, a creation stamp) in the
 * app's absolute format; a moment still ahead also says how far off it is.
 */
export function ExactTime({
  value,
  precision = "minute",
}: {
  value: string;
  precision?: TimePrecision;
}) {
  const at = useNow();
  return (
    <time dateTime={value} title={exactTime(value, "second")}>
      {exactTime(value, precision)}
      {Date.parse(value) > at && (
        <span className="muted"> ({relativeTime(value, at)})</span>
      )}
    </time>
  );
}

export function Duration({
  start,
  end,
}: {
  start: string;
  end: string | null;
}) {
  const at = useNow();
  return (
    <span className="duration">
      {end === null ? "running " : ""}
      {duration(start, end, at)}
    </span>
  );
}
