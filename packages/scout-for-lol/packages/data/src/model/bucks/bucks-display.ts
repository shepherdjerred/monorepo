const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

const PARLAY_DURATION_FIELDS = new Set([
  "gameDuration",
  "longestTimeSpentLiving",
  "timeCCingOthers",
  "timePlayed",
  "totalTimeCCDealt",
  "totalTimeSpentDead",
]);

/** Locale-fixed grouping for every user-visible whole number. */
export function formatInteger(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Cannot display non-integer value ${value.toString()}`);
  }
  return INTEGER_FORMATTER.format(value);
}

/** MM:SS, retaining total minutes instead of wrapping after an hour. */
export function formatDurationSeconds(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Cannot display invalid duration ${value.toString()}`);
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatParlayNumericValue(field: string, value: number): string {
  return PARLAY_DURATION_FIELDS.has(field)
    ? formatDurationSeconds(value)
    : formatInteger(value);
}
