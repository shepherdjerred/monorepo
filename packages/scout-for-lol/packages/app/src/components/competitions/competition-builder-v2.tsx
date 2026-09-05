import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { getAllSeasons } from "@scout-for-lol/data";
import {
  DEFAULT_COMPETITION_CRON,
  DEFAULT_SCHEDULE_TIMEZONE,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { CompetitionBuilderEntrants } from "#src/components/competitions/competition-builder-entrants.tsx";
import { CompetitionBuilderBasics } from "#src/components/competitions/competition-builder-basics.tsx";
import { CompetitionBuilderReview } from "#src/components/competitions/competition-builder-review.tsx";
import { CompetitionCriteriaFields } from "#src/components/competitions/competition-criteria-fields.tsx";
import { CompetitionDatesFields } from "#src/components/competitions/competition-dates-fields.tsx";
import {
  ReportScheduleFields,
  scheduleField,
} from "#src/components/reports/report-schedule-fields.tsx";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  FormPendingStatus,
  handleFormReset,
  handleFormSubmit,
  ServerFormError,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  UnsavedFormDialog,
  useUnsavedForm,
} from "#src/hooks/use-unsaved-form.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";
import {
  buildCompetitionSubmission,
  editableCompetitionBuilderValue,
  initialCompetitionBuilderState,
} from "#src/lib/competitions/competition-builder-state.ts";
import { buildCompetitionScenarios } from "#src/lib/competitions/competition-scenarios.ts";
import { browserTimezone } from "#src/lib/competitions/competition-time.ts";
import { CompetitionBuilderFormValueSchema } from "#src/lib/form-schemas.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function CompetitionBuilderV2(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  initialScenarioId?: string;
  onCreated: (competitionId: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  isNavigationAllowed?: () => boolean;
}) {
  const permissions = usePermissions(props.guildId);
  if (permissions.isLoading) {
    return <p className="text-sm text-scout-subtle">Loading builder…</p>;
  }
  return (
    <CompetitionBuilderReady
      {...props}
      canInvite={permissions.perms.can("competitions", "invite")}
      canSchedule={permissions.perms.can("competitions", "schedule")}
    />
  );
}

function CompetitionBuilderReady(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  initialScenarioId?: string;
  onCreated: (competitionId: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  isNavigationAllowed?: () => boolean;
  canInvite: boolean;
  canSchedule: boolean;
}) {
  const trpc = useTRPC();
  const formElement = useRef<HTMLFormElement>(null);
  const allowNavigation = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [initialState] = useState(() => {
    const timezone = browserTimezone();
    const initial = initialCompetitionBuilderState({
      channelId: props.channels[0]?.id ?? "",
      timezone,
      ...(props.initialScenarioId === undefined
        ? {}
        : { scenarioId: props.initialScenarioId }),
    });
    return props.canSchedule
      ? initial
      : {
          ...initial,
          scheduledUpdates: {
            enabled: false,
            cronExpression: DEFAULT_COMPETITION_CRON,
            timezone: DEFAULT_SCHEDULE_TIMEZONE,
          },
        };
  });
  const [starter, setStarter] = useState(initialState.starter);
  const [customized, setCustomized] = useState(initialState.customized);

  const mutation = useMutation(
    trpc.competition.create.mutationOptions({
      meta: analyticsMeta("competition_created"),
      onSuccess: (created) => {
        allowNavigation.current = true;
        props.onCreated(created.id);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  const form = useScoutForm({
    defaultValues: editableCompetitionBuilderValue(initialState),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: CompetitionBuilderFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = CompetitionBuilderFormValueSchema.parse(value);
      const submission = buildCompetitionSubmission(parsed);
      if (!submission.ok) throw new Error(submission.message);
      mutation.mutate({ guildId: props.guildId, ...submission.value });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const state = useSelector(form.store, (formState) => formState.values);
  const isDirty = useSelector(form.store, (formState) => formState.isDirty);
  const basicsErrors = useSelector(form.store, (formState) => ({
    title: fieldErrorMessage(formState.fieldMeta.title?.errors ?? []),
    description: fieldErrorMessage(
      formState.fieldMeta.description?.errors ?? [],
    ),
    channelId: fieldErrorMessage(formState.fieldMeta.channelId?.errors ?? []),
    maxParticipants: fieldErrorMessage(
      formState.fieldMeta.maxParticipants?.errors ?? [],
    ),
    visibility: fieldErrorMessage(formState.fieldMeta.visibility?.errors ?? []),
  }));
  const datesErrors = useSelector(form.store, (formState) => ({
    startDate: fieldErrorMessage(
      formState.fieldMeta["dates.startDate"]?.errors ?? [],
    ),
    endDate: fieldErrorMessage(
      formState.fieldMeta["dates.endDate"]?.errors ?? [],
    ),
    seasonId: fieldErrorMessage(
      formState.fieldMeta["dates.seasonId"]?.errors ?? [],
    ),
  }));
  const criteriaErrors = useSelector(form.store, (formState) => ({
    gameVariant: fieldErrorMessage(
      formState.fieldMeta.gameVariant?.errors ?? [],
    ),
    criteriaType: fieldErrorMessage(
      formState.fieldMeta["criteria.criteriaType"]?.errors ?? [],
    ),
    queues: fieldErrorMessage(
      formState.fieldMeta["criteria.queues"]?.errors ?? [],
    ),
    aggregation: fieldErrorMessage(
      formState.fieldMeta["criteria.aggregation"]?.errors ?? [],
    ),
    championId: fieldErrorMessage(
      formState.fieldMeta["criteria.championId"]?.errors ?? [],
    ),
    minGames: fieldErrorMessage(
      formState.fieldMeta["criteria.minGames"]?.errors ?? [],
    ),
  }));
  const { onDirtyChange } = props;
  const blocker = useUnsavedForm(isDirty, mutation.isPending, () => {
    return allowNavigation.current || props.isNavigationAllowed?.() === true;
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const scenarios = useMemo(
    () =>
      buildCompetitionScenarios({
        now: new Date(),
        timezone: state.analysisTimezone,
        seasons: getAllSeasons(),
      }),
    [state.analysisTimezone],
  );

  function markCustomized() {
    allowNavigation.current = false;
    if (starter !== null) setCustomized(true);
  }

  function applyScenario(id: string) {
    const scenario = scenarios.find((candidate) => candidate.id === id) ?? null;
    if (scenario === null) return;
    const value = scenario.value;
    if (value === null) return;
    form.setFieldValue("title", value.title);
    form.setFieldValue("description", value.description);
    form.setFieldValue("gameVariant", value.gameVariant);
    form.setFieldValue("dates", value.dates);
    form.setFieldValue("criteria", value.criteria);
    setStarter({ id: scenario.id, label: scenario.label });
    setCustomized(false);
  }

  const channelName = props.channels.find(
    (channel) => channel.id === state.channelId,
  )?.name;
  const reviewState = { ...state, starter, customized };

  return (
    <form.AppForm>
      <form
        ref={formElement}
        className="space-y-4"
        aria-busy={mutation.isPending}
        onChange={markCustomized}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
        onReset={(event) => {
          handleFormReset(event, () => {
            form.reset();
          });
          setStarter(initialState.starter);
          setCustomized(initialState.customized);
          setError(null);
        }}
      >
        <fieldset
          disabled={mutation.isPending}
          className="m-0 space-y-4 border-0 p-0"
        >
          <Card>
            <CardHeader>
              <CardTitle>Start with a scenario</CardTitle>
              <CardDescription>
                Starters fill the scoring and date window. Every field remains
                editable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {starter === null ? null : (
                <p className="text-sm font-medium text-scout-accent">
                  {customized
                    ? `Customized from ${starter.label}`
                    : starter.label}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {scenarios.map((scenario) => (
                  <Button
                    key={scenario.id}
                    type="button"
                    variant={
                      starter?.id === scenario.id ? "secondary" : "outline"
                    }
                    className="h-auto min-h-20 items-start justify-start whitespace-normal p-3 text-left"
                    disabled={scenario.value === null}
                    title={scenario.unavailableReason}
                    onClick={() => {
                      applyScenario(scenario.id);
                    }}
                  >
                    <span className="w-full text-left">
                      <span className="block font-medium">
                        {scenario.label}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-scout-subtle">
                        {scenario.unavailableReason ?? scenario.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <BuilderSection
            title="Competition setup"
            description="Configure its identity, date window, game version, queues, and scoring."
          >
            <CompetitionBuilderBasics
              state={reviewState}
              channels={props.channels}
              errors={basicsErrors}
              onChange={(changes) => {
                for (const [key, value] of Object.entries(changes)) {
                  if (key === "title" && typeof value === "string") {
                    form.setFieldValue("title", value);
                  } else if (
                    key === "description" &&
                    typeof value === "string"
                  ) {
                    form.setFieldValue("description", value);
                  } else if (key === "channelId" && typeof value === "string") {
                    form.setFieldValue("channelId", value);
                  } else if (
                    key === "visibility" &&
                    (value === "OPEN" ||
                      value === "INVITE_ONLY" ||
                      value === "SERVER_WIDE")
                  ) {
                    form.setFieldValue("visibility", value);
                  } else if (
                    key === "maxParticipants" &&
                    typeof value === "string"
                  ) {
                    form.setFieldValue("maxParticipants", value);
                  }
                }
              }}
            />
            <CompetitionDatesFields
              value={state.dates}
              timezone={state.analysisTimezone}
              errors={datesErrors}
              onChange={(dates) => {
                form.setFieldValue("dates", dates);
              }}
              onTimezoneChange={(timezone) => {
                form.setFieldValue("analysisTimezone", timezone);
              }}
            />
            <CompetitionCriteriaFields
              value={state.criteria}
              gameVariant={state.gameVariant}
              errors={criteriaErrors}
              onChange={(criteria) => {
                form.setFieldValue("criteria", criteria);
              }}
              onGameVariantChange={(gameVariant) => {
                form.setFieldValue("gameVariant", gameVariant);
              }}
            />
          </BuilderSection>
          <BuilderSection
            title="Entrants"
            description="Choose who starts on the roster."
          >
            <form.AppField name="initialPlayerIds">
              {(field) => (
                <CompetitionBuilderEntrants
                  guildId={props.guildId}
                  visibility={state.visibility}
                  selected={field.state.value}
                  cap={Number(state.maxParticipants)}
                  canInvite={props.canInvite}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              )}
            </form.AppField>
          </BuilderSection>
          <BuilderSection
            title="Updates"
            description="Start and final announcements always post. Leaderboard updates are optional."
          >
            {props.canSchedule ? (
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-scout-ink">
                    Post leaderboard updates
                  </span>
                  <form.AppField name="scheduledUpdates.enabled">
                    {(field) => (
                      <input
                        id="competition-updates"
                        name={field.name}
                        type="checkbox"
                        className="size-5"
                        checked={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.checked);
                        }}
                      />
                    )}
                  </form.AppField>
                </label>
                {state.scheduledUpdates.enabled ? (
                  <form.AppField name="scheduledUpdates.cronExpression">
                    {(cronField) => (
                      <form.AppField name="scheduledUpdates.timezone">
                        {(timezoneField) => (
                          <ReportScheduleFields
                            cron={scheduleField(cronField)}
                            timezone={scheduleField(timezoneField)}
                          />
                        )}
                      </form.AppField>
                    )}
                  </form.AppField>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-scout-subtle">
                Leaderboard updates are off. The competition schedule permission
                is required to enable or customize them.
              </p>
            )}
          </BuilderSection>
          <BuilderSection
            title="Review"
            description="This is the exact setup Scout will submit."
          >
            <CompetitionBuilderReview
              state={reviewState}
              channelName={channelName}
            />
          </BuilderSection>
        </fieldset>

        <ServerFormError error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="reset" variant="outline" disabled={mutation.isPending}>
            Reset
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending || props.channels.length === 0}
          >
            {mutation.isPending ? "Creating…" : "Create competition"}
          </Button>
        </div>
        <FormPendingStatus pending={mutation.isPending}>
          Creating competition…
        </FormPendingStatus>
      </form>
      <UnsavedFormDialog blocker={blocker} />
    </form.AppForm>
  );
}

function BuilderSection(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}
