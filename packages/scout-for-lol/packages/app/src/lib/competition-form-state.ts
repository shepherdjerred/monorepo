import {
  CompetitionCriteriaSchema,
  SeasonIdSchema,
  type CompetitionCriteria,
} from "@scout-for-lol/data";
import type { CriteriaState } from "#src/components/competition-criteria-fields.tsx";
import type { DatesState } from "#src/components/competition-dates-fields.tsx";
import type { FormState } from "#src/components/competition-form-fields.tsx";

export type DatesValue =
  | { type: "FIXED_DATES"; startDate: Date; endDate: Date }
  | { type: "SEASON"; seasonId: ReturnType<typeof SeasonIdSchema.parse> };

export function buildCriteria(
  state: CriteriaState,
): { ok: true; value: CompetitionCriteria } | { ok: false; message: string } {
  const queue = state.queue === "__ANY__" ? undefined : state.queue;
  const raw =
    state.criteriaType === "MOST_WINS_CHAMPION"
      ? {
          type: state.criteriaType,
          championId: Number(state.championId),
          ...(queue === undefined ? {} : { queue }),
        }
      : state.criteriaType === "HIGHEST_WIN_RATE"
        ? {
            type: state.criteriaType,
            minGames: Number(state.minGames),
            queue: state.queue,
          }
        : { type: state.criteriaType, queue: state.queue };
  const parsed = CompetitionCriteriaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Fill in the criteria fields correctly." };
  }
  return { ok: true, value: parsed.data };
}

export function buildDates(
  state: DatesState,
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
  return {
    ok: true,
    value: {
      type: "FIXED_DATES",
      startDate: new Date(state.startDate),
      endDate: new Date(state.endDate),
    },
  };
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
  const criteria = buildCriteria(state.criteria);
  if (!criteria.ok) {
    return { ok: false, message: criteria.message };
  }
  const dates = buildDates(state.dates);
  if (!dates.ok) {
    return { ok: false, message: dates.message };
  }
  return {
    ok: true,
    maxParticipants,
    criteria: criteria.value,
    dates: dates.value,
  };
}
