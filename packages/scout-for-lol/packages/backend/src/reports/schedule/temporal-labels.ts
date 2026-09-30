export function localCalendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format temporal range in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

export function comparePatchLabels(left: string, right: string): number {
  const leftPatch = patchParts(left);
  const rightPatch = patchParts(right);
  return (
    leftPatch.major - rightPatch.major || leftPatch.minor - rightPatch.minor
  );
}

function patchParts(label: string): { major: number; minor: number } {
  const groups = /^(?<major>\d+)\.(?<minor>\d+)$/u.exec(label)?.groups;
  if (groups === undefined) {
    throw new Error(`Invalid temporal patch bucket ${label}.`);
  }
  return { major: Number(groups["major"]), minor: Number(groups["minor"]) };
}
