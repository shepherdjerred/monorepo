export function formatDisplayTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function startOfDisplayDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  if (![year, month, day].every((value) => Number.isFinite(value))) {
    throw new Error(`Unable to calculate start of day for ${timeZone}`);
  }
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const offsetAtMidnight = timeZoneOffsetMs(
    new Date(localMidnightAsUtc),
    timeZone,
  );
  const firstPass = new Date(localMidnightAsUtc - offsetAtMidnight);
  const correctedOffset = timeZoneOffsetMs(firstPass, timeZone);
  return new Date(localMidnightAsUtc - correctedOffset);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );
  return represented - date.getTime();
}
