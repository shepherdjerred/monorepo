import type { CompetitionWithCriteria } from "@scout-for-lol/data";

export function resolveCompetitionAnalysisDates(params: {
  competition: CompetitionWithCriteria;
  mode: "official" | "selected_period";
  startDate?: string;
  endDate?: string;
  now: Date;
}): { startDate: string; endDate: string } {
  const competitionStart =
    params.competition.startDate ?? params.competition.createdTime;
  const competitionEnd =
    params.competition.endDate === null ||
    params.competition.endDate > params.now
      ? params.now
      : params.competition.endDate;
  if (params.mode === "official") {
    return {
      startDate: localCalendarDate(
        competitionStart,
        params.competition.analysisTimezone,
      ),
      endDate: localCalendarDate(
        competitionEnd,
        params.competition.analysisTimezone,
      ),
    };
  }
  return {
    startDate:
      params.startDate ??
      localCalendarDate(
        params.competition.startDate ??
          new Date(params.now.getTime() - 30 * 86_400_000),
        params.competition.analysisTimezone,
      ),
    endDate:
      params.endDate ??
      localCalendarDate(competitionEnd, params.competition.analysisTimezone),
  };
}

function localCalendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format a calendar date in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}
