export function competitionAnalysisDateInput(
  value: Date | string | null,
  timezone: string,
): string {
  if (value === null) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

function datePart(
  parts: Intl.DateTimeFormatPart[],
  type: "year" | "month" | "day",
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`Competition analysis date is missing its ${type}.`);
  }
  return part.value;
}
