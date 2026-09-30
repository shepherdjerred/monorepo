import type { Temporal } from "@js-temporal/polyfill";

import type { DigestKind } from "#shared/ops-schema";

/** Digests are scheduled and keyed in Jerred's local time. */
export const DIGEST_TIME_ZONE = "America/Los_Angeles";

export type DigestPeriod = {
  kind: DigestKind;
  /** `YYYY-MM-DD` (daily) or `YYYY-Www` (weekly, ISO week), local time. */
  key: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
};

const PERIOD_LENGTH: Record<DigestKind, Temporal.DurationLike> = {
  daily: { hours: 24 },
  weekly: { hours: 7 * 24 },
};

export function digestPeriodKey(
  kind: DigestKind,
  now: Temporal.Instant,
): string {
  const date = now.toZonedDateTimeISO(DIGEST_TIME_ZONE).toPlainDate();
  if (kind === "daily") return date.toString();
  const week = date.weekOfYear;
  const year = date.yearOfWeek;
  if (week === undefined || year === undefined)
    throw new Error("ISO calendar did not provide a week number");
  return `${String(year)}-W${String(week).padStart(2, "0")}`;
}

/**
 * The period a digest sent at `now` reports on: the trailing day or week, and
 * the idempotency key for that send. A retried schedule on the same local day
 * (or ISO week) maps to the same key.
 */
export function digestPeriod(
  kind: DigestKind,
  now: Temporal.Instant,
): DigestPeriod {
  return {
    kind,
    key: digestPeriodKey(kind, now),
    start: now.subtract(PERIOD_LENGTH[kind]),
    end: now,
  };
}

export function digestMessageId(kind: DigestKind, key: string): string {
  return `<ops-digest-${kind}-${key}@sjer.red>`;
}
