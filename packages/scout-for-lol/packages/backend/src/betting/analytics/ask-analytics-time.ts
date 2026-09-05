export function parseBucksAskDateRange(
  from: string | undefined,
  to: string | undefined,
): { from: number | undefined; to: number | undefined } {
  const range = {
    from: from === undefined ? undefined : Date.parse(from),
    to: to === undefined ? undefined : Date.parse(to),
  };
  if (
    range.from !== undefined &&
    range.to !== undefined &&
    range.from > range.to
  ) {
    throw new Error("The analytics date range starts after it ends");
  }
  return range;
}

export function withinBucksAskDateRange(
  date: Date,
  range: { from: number | undefined; to: number | undefined },
): boolean {
  const timestamp = date.getTime();
  return (
    (range.from === undefined || timestamp >= range.from) &&
    (range.to === undefined || timestamp <= range.to)
  );
}

export function bucksAskDateRange(dates: readonly Date[]): {
  earliestAt: string | null;
  latestAt: string | null;
} {
  if (dates.length === 0) {
    return { earliestAt: null, latestAt: null };
  }
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const date of dates) {
    const timestamp = date.getTime();
    earliest = Math.min(earliest, timestamp);
    latest = Math.max(latest, timestamp);
  }
  return {
    earliestAt: new Date(earliest).toISOString(),
    latestAt: new Date(latest).toISOString(),
  };
}

export function bucksAskIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
