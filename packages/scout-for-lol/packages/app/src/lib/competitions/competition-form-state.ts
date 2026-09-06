import {
  CompetitionConfigurationSchema,
  SeasonIdSchema,
  type CompetitionCriteria,
} from "@scout-for-lol/data";
import type { FormState } from "#src/components/competitions/competition-form-fields.tsx";
import { fixedDateRangeInTimezone } from "#src/lib/competitions/competition-time.ts";
import {
  CompetitionFormValueSchema,
  type CompetitionFormValue,
} from "#src/lib/form-schemas.ts";

export type DatesValue =
  | { type: "FIXED_DATES"; startDate: Date; endDate: Date }
  | { type: "SEASON"; seasonId: ReturnType<typeof SeasonIdSchema.parse> };

export function buildCriteria(
  state: FormState["criteria"],
  gameVariant: FormState["gameVariant"],
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
  const parsed = CompetitionConfigurationSchema.safeParse({
    gameVariant,
    criteria: raw,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Choose queues and scoring compatible with the game version.",
    };
  }
  return { ok: true, value: parsed.data.criteria };
}

export function buildDates(
  state: FormState["dates"],
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

export function validateForm(state: CompetitionFormValue):
  | {
      ok: true;
      maxParticipants: number;
      criteria: CompetitionCriteria;
      dates: DatesValue;
    }
  | { ok: false; message: string } {
  const parsed = CompetitionFormValueSchema.safeParse(state);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Check the competition fields.",
    };
  }
  const maxParticipants = Number(parsed.data.maxParticipants);
  const criteria = buildCriteria(parsed.data.criteria, parsed.data.gameVariant);
  if (!criteria.ok) {
    return { ok: false, message: criteria.message };
  }
  const dates = buildDates(parsed.data.dates, parsed.data.analysisTimezone);
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
