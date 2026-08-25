import {
  CompetitionCriteriaSchema,
  CompetitionConfigurationSchema,
  SeasonIdSchema,
  type CompetitionCriteria,
} from "@scout-for-lol/data";
import type { CriteriaState } from "#src/components/competition-criteria-fields.tsx";
import type { DatesState } from "#src/components/competition-dates-fields.tsx";
import type { FormState } from "#src/components/competition-form-fields.tsx";
import { fixedDateRangeInTimezone } from "#src/lib/competition-time.ts";

export type DatesValue =
  | { type: "FIXED_DATES"; startDate: Date; endDate: Date }
  | { type: "SEASON"; seasonId: ReturnType<typeof SeasonIdSchema.parse> };

export function buildCriteria(
  state: CriteriaState,
): { ok: true; value: CompetitionCriteria } | { ok: false; message: string } {
  const raw =
    state.criteriaType === "MOST_WINS_CHAMPION"
      ? {
          type: state.criteriaType,
          championId: Number(state.championId),
          queues: state.queues,
        }
      : state.criteriaType === "HIGHEST_WIN_RATE"
        ? {
            type: state.criteriaType,
            minGames: Number(state.minGames),
            queues: state.queues,
          }
        : state.criteriaType === "HIGHEST_RANK" ||
            state.criteriaType === "MOST_RANK_CLIMB"
          ? {
              type: state.criteriaType,
              queues: state.queues,
              aggregation: state.aggregation,
            }
          : { type: state.criteriaType, queues: state.queues };
  const parsed = CompetitionCriteriaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Fill in the criteria fields correctly." };
  }
  return { ok: true, value: parsed.data };
}

export function buildDates(
  state: DatesState,
  timezone: string,
): { ok: true; value: DatesValue } | { ok: false; message: string } {
  if (state.mode === "SEASON") {
    const parsed = SeasonIdSchema.safeParse(state.seasonId);
    if (!parsed.success) {
      return { ok: false, message: "Pick a season." };
    }
    return { ok: true, value: { type: "SEASON", seasonId: parsed.data } };
  }
  if (state.startDate === "" || state.endDate === "") {
    return { ok: false, message: "Pick a start and end date." };
  }
  try {
    return {
      ok: true,
      value: {
        type: "FIXED_DATES",
        ...fixedDateRangeInTimezone(state.startDate, state.endDate, timezone),
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function validateForm(state: FormState):
  | {
      ok: true;
      maxParticipants: number;
      criteria: CompetitionCriteria;
      dates: DatesValue;
    }
  | { ok: false; message: string } {
  const maxParticipants = Number(state.maxParticipants);
  if (!Number.isInteger(maxParticipants)) {
    return { ok: false, message: "Max participants must be a whole number." };
  }
  if (maxParticipants < 2 || maxParticipants > 100) {
    return {
      ok: false,
      message: "Max participants must be between 2 and 100.",
    };
  }
  const criteria = buildCriteria(state.criteria);
  if (!criteria.ok) {
    return { ok: false, message: criteria.message };
  }
  const configuration = CompetitionConfigurationSchema.safeParse({
    gameVariant: state.gameVariant,
    criteria: criteria.value,
  });
  if (!configuration.success) {
    return {
      ok: false,
      message: "Choose queues and scoring compatible with the game version.",
    };
  }
  const dates = buildDates(state.dates, state.analysisTimezone);
  if (!dates.ok) {
    return { ok: false, message: dates.message };
  }
  return {
    ok: true,
    maxParticipants,
    criteria: configuration.data.criteria,
    dates: dates.value,
  };
}
