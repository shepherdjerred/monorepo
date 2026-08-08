import { Temporal } from "@js-temporal/polyfill";

export function formatInstant(value: string | null): string {
  if (value === null) return "—";
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function age(value: string | null): string {
  if (value === null) return "never";
  const seconds = Math.max(
    0,
    Math.floor(
      Temporal.Now.instant()
        .since(Temporal.Instant.from(value))
        .total({ unit: "seconds" }),
    ),
  );
  if (seconds < 60) return `${String(seconds)}s ago`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86_400))}d ago`;
}
