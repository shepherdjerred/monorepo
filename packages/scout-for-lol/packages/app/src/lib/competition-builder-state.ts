import {
  type CompetitionCriteria,
  type PlayerId,
  getAllSeasons,
} from "@scout-for-lol/data";
import {
  CompetitionScheduledUpdatesSchema,
  DEFAULT_V2_COMPETITION_CRON,
} from "@scout-for-lol/data/model/competition-cron.ts";
import {
  EMPTY_STATE,
  type FormState,
} from "#src/components/competition-form-fields.tsx";
import {
  buildCompetitionScenarios,
  type CompetitionScenario,
} from "#src/lib/competition-scenarios.ts";
import { validateForm } from "#src/lib/competition-form-state.ts";
import type { DatesValue } from "#src/lib/competition-form-state.ts";

export type CompetitionBuilderState = FormState & {
  initialPlayerIds: PlayerId[];
  scheduledUpdates: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
  };
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

export function buildCompetitionSubmission(state: CompetitionBuilderState):
  | {
      ok: true;
      value: {
        channelId: string;
        title: string;
        description: string;
        visibility: CompetitionBuilderState["visibility"];
        maxParticipants: number;
        dates: DatesValue;
        criteria: CompetitionCriteria;
        initialPlayerIds: PlayerId[];
        analysisTimezone: string;
        scheduledUpdates: CompetitionBuilderState["scheduledUpdates"];
      };
    }
  | { ok: false; message: string } {
  const validated = validateForm(state);
  if (!validated.ok) return validated;
  const schedule = CompetitionScheduledUpdatesSchema.safeParse(
    state.scheduledUpdates,
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
      channelId: state.channelId,
      title: state.title,
      description: state.description,
      visibility: state.visibility,
      maxParticipants: validated.maxParticipants,
      dates: validated.dates,
      criteria: validated.criteria,
      initialPlayerIds:
        state.visibility === "SERVER_WIDE" ? [] : state.initialPlayerIds,
      analysisTimezone: state.analysisTimezone,
      scheduledUpdates: schedule.data,
    },
  };
}
