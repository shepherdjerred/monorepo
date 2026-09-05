import {
  type CompetitionCriteria,
  type PlayerId,
  getAllSeasons,
} from "@scout-for-lol/data";
import {
  CompetitionScheduledUpdatesSchema,
  DEFAULT_V2_COMPETITION_CRON,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { EMPTY_STATE } from "#src/components/competitions/competition-form-fields.tsx";
import {
  buildCompetitionScenarios,
  type CompetitionScenario,
} from "#src/lib/competitions/competition-scenarios.ts";
import { validateForm } from "#src/lib/competitions/competition-form-state.ts";
import type { DatesValue } from "#src/lib/competitions/competition-form-state.ts";
import {
  CompetitionBuilderFormValueSchema,
  type CompetitionBuilderFormValue,
} from "#src/lib/form-schemas.ts";

export type CompetitionBuilderState = CompetitionBuilderFormValue & {
  starter: { id: string; label: string } | null;
  customized: boolean;
};

export type CompetitionBuilderAction =
  | { type: "apply-scenario"; scenario: CompetitionScenario }
  | { type: "edit"; changes: Partial<CompetitionBuilderState> };

export function competitionBuilderReducer(
  state: CompetitionBuilderState,
  action: CompetitionBuilderAction,
): CompetitionBuilderState {
  if (action.type === "apply-scenario") {
    if (action.scenario.value === null) return state;
    return {
      ...state,
      ...action.scenario.value,
      starter: { id: action.scenario.id, label: action.scenario.label },
      customized: false,
    };
  }
  return {
    ...state,
    ...action.changes,
    customized: state.starter === null ? false : true,
  };
}

export function initialCompetitionBuilderState(options: {
  channelId: string;
  timezone: string;
  now?: Date;
  scenarioId?: string;
}): CompetitionBuilderState {
  const base: CompetitionBuilderState = {
    ...EMPTY_STATE,
    channelId: options.channelId,
    analysisTimezone: options.timezone,
    initialPlayerIds: [],
    scheduledUpdates: {
      enabled: true,
      cronExpression: DEFAULT_V2_COMPETITION_CRON,
      timezone: options.timezone,
    },
    starter: null,
    customized: false,
  };
  const scenarios = buildCompetitionScenarios({
    now: options.now ?? new Date(),
    timezone: options.timezone,
    seasons: getAllSeasons(),
  });
  const scenario = scenarios.find(
    (candidate) => candidate.id === (options.scenarioId ?? "blank"),
  );
  return scenario === undefined
    ? base
    : competitionBuilderReducer(base, { type: "apply-scenario", scenario });
}

export function editableCompetitionBuilderValue(
  state: CompetitionBuilderState,
): CompetitionBuilderFormValue {
  const { starter: _starter, customized: _customized, ...value } = state;
  return value;
}

export function buildCompetitionSubmission(state: CompetitionBuilderFormValue):
  | {
      ok: true;
      value: {
        channelId: string;
        title: string;
        description: string;
        visibility: CompetitionBuilderFormValue["visibility"];
        gameVariant: CompetitionBuilderFormValue["gameVariant"];
        maxParticipants: number;
        dates: DatesValue;
        criteria: CompetitionCriteria;
        initialPlayerIds: PlayerId[];
        analysisTimezone: string;
        scheduledUpdates: CompetitionBuilderFormValue["scheduledUpdates"];
      };
    }
  | { ok: false; message: string } {
  const result = CompetitionBuilderFormValueSchema.safeParse(state);
  if (!result.success) {
    return {
      ok: false,
      message:
        result.error.issues[0]?.message ?? "Check the competition details.",
    };
  }
  const parsed = result.data;
  const validated = validateForm(parsed);
  if (!validated.ok) return validated;
  const schedule = CompetitionScheduledUpdatesSchema.safeParse(
    parsed.scheduledUpdates,
  );
  if (!schedule.success) {
    return {
      ok: false,
      message:
        schedule.error.issues[0]?.message ?? "Check the update schedule.",
    };
  }
  return {
    ok: true,
    value: {
      channelId: parsed.channelId,
      title: parsed.title,
      description: parsed.description,
      visibility: parsed.visibility,
      gameVariant: parsed.gameVariant,
      maxParticipants: validated.maxParticipants,
      dates: validated.dates,
      criteria: validated.criteria,
      initialPlayerIds:
        parsed.visibility === "SERVER_WIDE" ? [] : parsed.initialPlayerIds,
      analysisTimezone: parsed.analysisTimezone,
      scheduledUpdates: schedule.data,
    },
  };
}
