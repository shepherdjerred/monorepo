/**
 * Recurrence corpus — the fixed frame of reference and its naive-date helpers.
 *
 * Every date here is UTC-only on purpose. `@tasknotes/model` builds its rrule
 * DTSTART with `Date.UTC(y, m, d, 0, 0, 0, 0)` and reads results back with
 * `getUTC*`, never setting a `tzid`, so the parity surface is naive-date
 * arithmetic with no DST. Using a local-time `Date` anywhere in the generator
 * would reintroduce the very timezone dependency the corpus is meant to prove
 * absent — the app itself has that bug today, in
 * `src/domain/recurrence.ts`'s `localDate()`.
 *
 * Split out of `build-recurrence-corpus.ts` to stay inside the repository's
 * 500-line limit.
 */

/** Never `new Date()`: the corpus must be reproducible byte-for-byte. */
export const ANCHOR_DATE = "2026-01-01";
/** ANCHOR_DATE - 5 years. */
export const WINDOW_START = "2021-01-01";
/** ANCHOR_DATE + 5 years, less the anchor day itself: 3652 days inclusive. */
export const WINDOW_END = "2030-12-31";

export const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` as UTC midnight, rejecting non-existent calendar dates. */
export function utcDate(ymd: string): Date {
  if (!YMD_PATTERN.test(ymd)) {
    throw new TypeError(`expected YYYY-MM-DD, got "${ymd}"`);
  }
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`not a real calendar date: "${ymd}"`);
  }
  return date;
}

export function toYmd(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(ymd: string, days: number): string {
  return toYmd(new Date(utcDate(ymd).getTime() + days * MS_PER_DAY));
}

export function daysBetween(startYmd: string, endYmd: string): number {
  return (utcDate(endYmd).getTime() - utcDate(startYmd).getTime()) / MS_PER_DAY;
}
