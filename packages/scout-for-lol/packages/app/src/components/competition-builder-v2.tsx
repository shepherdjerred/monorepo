import { useMemo, useReducer, useState } from "react";
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
import { Label } from "@scout-for-lol/design-system/components/label";
import { Switch } from "@scout-for-lol/design-system/components/switch";
import { CompetitionBuilderBasics } from "#src/components/competition-builder-basics.tsx";
import { CompetitionBuilderEntrants } from "#src/components/competition-builder-entrants.tsx";
import { CompetitionBuilderReview } from "#src/components/competition-builder-review.tsx";
import { CompetitionCriteriaFields } from "#src/components/competition-criteria-fields.tsx";
import { CompetitionDatesFields } from "#src/components/competition-dates-fields.tsx";
import { ReportScheduleFields } from "#src/components/report-schedule-fields.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import {
  buildCompetitionSubmission,
  competitionBuilderReducer,
  initialCompetitionBuilderState,
  type CompetitionBuilderState,
} from "#src/lib/competition-builder-state.ts";
import { buildCompetitionScenarios } from "#src/lib/competition-scenarios.ts";
import { browserTimezone } from "#src/lib/competition-time.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function CompetitionBuilderV2(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  initialScenarioId?: string;
  onCreated: (competitionId: number) => void;
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
  canInvite: boolean;
  canSchedule: boolean;
}) {
  const trpc = useTRPC();
  const timezone = browserTimezone();
  const [state, dispatch] = useReducer(
    competitionBuilderReducer,
    undefined,
    () => {
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
    },
  );
  const [error, setError] = useState<string | null>(null);
  const scenarios = useMemo(
    () =>
      buildCompetitionScenarios({
        now: new Date(),
        timezone: state.analysisTimezone,
        seasons: getAllSeasons(),
      }),
    [state.analysisTimezone],
  );
  const mutation = useMutation(
    trpc.competition.create.mutationOptions({
      meta: analyticsMeta("competition_created"),
      onSuccess: (created) => {
        props.onCreated(created.id);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  function edit(changes: Partial<CompetitionBuilderState>) {
    dispatch({ type: "edit", changes });
  }

  function applyScenario(id: string) {
    const scenario = buildCompetitionScenarios({
      now: new Date(),
      timezone: state.analysisTimezone,
      seasons: getAllSeasons(),
    }).find((candidate) => candidate.id === id);
    if (scenario !== undefined) {
      dispatch({ type: "apply-scenario", scenario });
    }
  }

  function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const submission = buildCompetitionSubmission(state);
    if (!submission.ok) {
      setError(submission.message);
      return;
    }
    mutation.mutate({ guildId: props.guildId, ...submission.value });
  }

  const channelName = props.channels.find(
    (channel) => channel.id === state.channelId,
  )?.name;
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Start with a scenario</CardTitle>
          <CardDescription>
            Starters fill the scoring and date window. Every field remains
            editable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.starter !== null && (
            <p className="text-sm font-medium text-scout-accent">
              {state.customized
                ? `Customized from ${state.starter.label}`
                : state.starter.label}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {scenarios.map((scenario) => (
              <Button
                key={scenario.id}
                type="button"
                variant={
                  state.starter?.id === scenario.id ? "secondary" : "outline"
                }
                className="h-auto min-h-20 justify-start whitespace-normal p-3 text-left"
                disabled={scenario.value === null}
                title={scenario.unavailableReason}
                onClick={() => {
                  applyScenario(scenario.id);
                }}
              >
                <span>
                  <span className="block font-medium">{scenario.label}</span>
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
        title="Basics"
        description="Name the competition and choose where it runs."
      >
        <CompetitionBuilderBasics
          state={state}
          channels={props.channels}
          onChange={edit}
        />
      </BuilderSection>
      <BuilderSection
        title="Entrants"
        description="Choose who starts on the roster."
      >
        <CompetitionBuilderEntrants
          guildId={props.guildId}
          visibility={state.visibility}
          selected={state.initialPlayerIds}
          cap={Number(state.maxParticipants)}
          canInvite={props.canInvite}
          onChange={(initialPlayerIds) => {
            edit({ initialPlayerIds });
          }}
        />
      </BuilderSection>
      <BuilderSection
        title="Scoring"
        description="The one metric Scout will rank."
      >
        <CompetitionCriteriaFields
          value={state.criteria}
          gameVariant={state.gameVariant}
          onChange={(criteria) => {
            edit({ criteria });
          }}
          onGameVariantChange={(gameVariant) => {
            edit({
              gameVariant,
              criteria: {
                ...state.criteria,
                criteriaType:
                  gameVariant === "CLASSIC" &&
                  (state.criteria.criteriaType === "HIGHEST_RANK" ||
                    state.criteria.criteriaType === "MOST_RANK_CLIMB")
                    ? "MOST_GAMES_PLAYED"
                    : state.criteria.criteriaType,
                queues: ["ALL"],
                championId: "",
                aggregation: "MAX",
              },
            });
          }}
        />
      </BuilderSection>
      <BuilderSection
        title="Window"
        description="Choose a League season or inclusive local dates."
      >
        <CompetitionDatesFields
          value={state.dates}
          timezone={state.analysisTimezone}
          onChange={(dates) => {
            edit({ dates });
          }}
          onTimezoneChange={(analysisTimezone) => {
            edit({ analysisTimezone });
          }}
        />
      </BuilderSection>
      <BuilderSection
        title="Updates"
        description="Start and final announcements always post. Leaderboard updates are optional."
      >
        {props.canSchedule ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="competition-updates">
                Post leaderboard updates
              </Label>
              <Switch
                id="competition-updates"
                checked={state.scheduledUpdates.enabled}
                onCheckedChange={(enabled) => {
                  edit({
                    scheduledUpdates: { ...state.scheduledUpdates, enabled },
                  });
                }}
              />
            </div>
            {state.scheduledUpdates.enabled && (
              <ReportScheduleFields
                cronExpression={state.scheduledUpdates.cronExpression}
                scheduleTimezone={state.scheduledUpdates.timezone}
                onCronChange={(cronExpression) => {
                  edit({
                    scheduledUpdates: {
                      ...state.scheduledUpdates,
                      cronExpression,
                    },
                  });
                }}
                onTimezoneChange={(scheduleTimezone) => {
                  edit({
                    scheduledUpdates: {
                      ...state.scheduledUpdates,
                      timezone: scheduleTimezone,
                    },
                  });
                }}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-scout-subtle">
            Leaderboard updates are off. The competition schedule permission is
            required to enable or customize them.
          </p>
        )}
      </BuilderSection>
      <BuilderSection
        title="Review"
        description="This is the exact setup Scout will submit."
      >
        <CompetitionBuilderReview state={state} channelName={channelName} />
      </BuilderSection>

      {error !== null && <p className="text-sm text-scout-danger">{error}</p>}
      <Button
        type="submit"
        disabled={mutation.isPending || props.channels.length === 0}
      >
        {mutation.isPending ? "Creating…" : "Create competition"}
      </Button>
    </form>
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
