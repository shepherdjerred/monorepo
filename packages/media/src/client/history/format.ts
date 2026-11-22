/*
 * How the History page says its numbers: how long something was watched,
 * how many plays, what share of them, and how far through a title a
 * stream is.
 */

const MINUTE = 60_000;
/** From here up, minutes are noise: "1,474 hr", not "1,474 hr 12 min". */
const HOURS_ONLY_FROM = 100;

function unit(
  value: number,
  name: "hour" | "minute",
  locale: string | undefined,
): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: name,
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(value);
}

/** A whole number with the reader's digit grouping: "1,449". */
export function wholeNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * A length of watching: "Under a minute", "45 min", "1 hr 16 min", "2 hr",
 * and for a household's worth of it "1,474 hr".
 */
export function watchTime(milliseconds: number, locale?: string): string {
  const minutes = Math.round(milliseconds / MINUTE);
  if (minutes === 0) {
    return milliseconds > 0 ? "Under a minute" : unit(0, "minute", locale);
  }
  if (minutes < 60) return unit(minutes, "minute", locale);
  if (minutes >= HOURS_ONLY_FROM * 60) {
    return unit(Math.round(minutes / 60), "hour", locale);
  }
  const hours = unit(Math.floor(minutes / 60), "hour", locale);
  const rest = minutes % 60;
  return rest === 0 ? hours : `${hours} ${unit(rest, "minute", locale)}`;
}

/** "1 play", "1,449 plays". */
export function playCount(plays: number, locale?: string): string {
  return plays === 1 ? "1 play" : `${wholeNumber(plays, locale)} plays`;
}

/**
 * A part of a whole as a percentage, or null when there is no whole to be a
 * part of. A part that exists is never rounded away to "0%", nor a part
 * that is not everything up to "100%".
 */
export function share(
  part: number,
  whole: number,
  locale?: string,
): string | null {
  if (whole <= 0) return null;
  const exact = (part / whole) * 100;
  const rounded = Math.round(exact);
  const shown =
    rounded === 0 && part > 0
      ? 1
      : rounded === 100 && part < whole
        ? 99
        : rounded;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(shown / 100);
}

/**
 * How far through a title a stream is, for a progress bar and in words. A
 * title whose length Plex did not report still gets a bar that can be drawn,
 * and a position past the reported end is held at the end.
 */
export function playPosition(
  progressMs: number,
  durationMs: number,
  locale?: string,
): { value: number; max: number; label: string } {
  const elapsed = Math.max(0, progressMs);
  const max = Math.max(1, durationMs);
  const value = Math.min(elapsed, max);
  return {
    value,
    max,
    label:
      durationMs <= 0
        ? unit(Math.round(elapsed / MINUTE), "minute", locale)
        : `${wholeNumber(Math.round(value / MINUTE), locale)} of ${unit(Math.round(durationMs / MINUTE), "minute", locale)}`,
  };
}

/**
 * The length of each bar in a ranking, as the value and maximum of a
 * `<progress>`: the busiest row fills its track and the rest are in
 * proportion. An empty ranking, or one with no plays at all, has no top to
 * measure against, so its bars are empty instead of dividing by zero.
 */
export function barScale(plays: readonly number[]): number {
  return Math.max(1, ...plays);
}
