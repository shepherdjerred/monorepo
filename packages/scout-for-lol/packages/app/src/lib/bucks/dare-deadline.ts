import type { DareDeadlineSpec } from "@scout-for-lol/data";

export function dareDeadlineDescription(dare: {
  deadlineAt: string | null;
  deadlineSpec: DareDeadlineSpec;
}): string {
  if (dare.deadlineAt !== null) {
    return new Date(dare.deadlineAt).toLocaleString();
  }
  if (dare.deadlineSpec.kind === "absolute") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: dare.deadlineSpec.timezone,
      timeZoneName: "short",
    }).format(new Date(dare.deadlineSpec.deadlineAt));
  }
  return `${dare.deadlineSpec.days.toString()} days after every target accepts`;
}
