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
const absolute = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});
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

export function RelativeTime({ value }: { value: string }) {
  const at = useNow();
  return (
    <time dateTime={value} title={absolute.format(new Date(value))}>
      {relativeTime(value, at)}
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
