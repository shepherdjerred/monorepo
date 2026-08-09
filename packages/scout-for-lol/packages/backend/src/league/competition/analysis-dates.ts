import {
  TemporalAnalysisSpecSchema,
  type CompetitionWithCriteria,
  type TemporalAnalysisSpec,
} from "@scout-for-lol/data";
import { localCalendarDate } from "#src/reports/temporal-labels.ts";

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

export function competitionAnalysisSpec(params: {
  startDate: string | Date;
  endDate: string | Date;
  timezone: string;
}): TemporalAnalysisSpec {
  return TemporalAnalysisSpecSchema.parse({
    window: {
      kind: "calendar",
      startDate:
        typeof params.startDate === "string"
          ? params.startDate
          : localCalendarDate(params.startDate, params.timezone),
      endDate:
        typeof params.endDate === "string"
          ? params.endDate
          : localCalendarDate(params.endDate, params.timezone),
    },
    bucket: "auto",
    timezone: params.timezone,
  });
}
