import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CompetitionIdSchema,
  type CompetitionCriteria,
  type CompetitionGameVariant,
  type CompetitionVisibility,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { FormActions } from "@scout-for-lol/design-system/components/forms/field";
import { channelAvailabilityForQuery } from "#src/components/channel-select-support.tsx";
import {
  editRecordNeedsLoad,
  EditRecordQueryState,
  EditRecordRefreshWarning,
  invalidEditRecordRoute,
  recordSubmitLabel,
} from "#src/components/edit-record-query-state.tsx";
import { CompetitionBuilder } from "#src/components/competition/competition-builder.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  competitionFormOptions,
  type FormState,
} from "#src/components/competition/competition-form-fields.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormReset,
  handleFormSubmit,
  ServerFormError,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  UnsavedFormDialog,
  useUnsavedForm,
} from "#src/hooks/use-unsaved-form.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { validateForm } from "#src/lib/bucks/competition-form-state.ts";
import { calendarDateInTimezone } from "#src/lib/bucks/competition-time.ts";
import { CompetitionFormValueSchema } from "#src/lib/form-schemas.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

export function CompetitionForm() {
  const { guildId, competitionId: idParam } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";
  const formElement = useRef<HTMLFormElement>(null);
  const allowNavigation = useRef(false);

  const idResult =
    idParam === undefined
      ? null
      : CompetitionIdSchema.safeParse(Number(idParam));
  const isEdit = idResult !== null;
  const competitionId =
    idResult?.success === true ? idResult.data : CompetitionIdSchema.parse(1);

  const [hydratedCompetitionId, setHydratedCompetitionId] = useState<
    number | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const existingQuery = useQuery(
    trpc.competition.get.queryOptions(
      { guildId: safeGuildId, competitionId },
      { enabled: guildId !== undefined && idResult?.success === true },
    ),
  );
  const existing = existingQuery.data;
  const formDefaults = useMemo(
    () =>
      existing === undefined ? EMPTY_STATE : existingToFormState(existing),
    [existing],
  );
  const isDraft = existing?.status === "DRAFT";

  const editMutation = useMutation(
    trpc.competition.edit.mutationOptions({
      meta: analyticsMeta("competition_edited"),
      onSuccess: () => {
        allowNavigation.current = true;
        void queryClient.invalidateQueries({
          queryKey: trpc.competition.list.pathKey(),
        });
        void navigate(
          `/g/${safeGuildId}/competitions/${competitionId.toString()}`,
        );
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const pending = editMutation.isPending;
  const form = useScoutForm({
    ...competitionFormOptions,
    defaultValues: formDefaults,
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: CompetitionFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = CompetitionFormValueSchema.parse(value);
      const validated = validateForm(parsed);
      if (!validated.ok) throw new Error(validated.message);
      const { maxParticipants, criteria, dates } = validated;
      // Only the edit route renders this form; creation is the builder's.
      editMutation.mutate({
        guildId: safeGuildId,
        competitionId,
        title: parsed.title,
        description: parsed.description,
        channelId: parsed.channelId,
        visibility: parsed.visibility,
        maxParticipants,
        analysisTimezone: parsed.analysisTimezone,
        ...(isDraft
          ? { dates, criteria, gameVariant: parsed.gameVariant }
          : {}),
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const isDirty = useSelector(form.store, (state) => state.isDirty);
  const state = useSelector(form.store, (formState) => formState.values);
  const channelAvailability = channelAvailabilityForQuery(channelsQuery);
  const canSubmit =
    channelsQuery.data?.some((channel) => channel.id === state.channelId) ===
    true;
  const blocker = useUnsavedForm(isDirty && !allowNavigation.current, pending);

  useEffect(() => {
    if (existing?.id !== competitionId) return;
    setHydratedCompetitionId(competitionId);
  }, [existing, competitionId]);

  const invalidRoute = invalidEditRecordRoute(
    guildId,
    isEdit,
    idResult?.success === true,
  );
  const isEditWaitingForData = editRecordNeedsLoad(
    isEdit,
    existing?.id,
    competitionId,
    hydratedCompetitionId,
  );

  const editForm = (
    <>
      <form
        ref={formElement}
        className="space-y-5"
        aria-busy={pending}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
        onReset={(event) => {
          handleFormReset(event, () => {
            form.reset();
          });
          setError(null);
        }}
      >
        <fieldset disabled={pending} className="m-0 space-y-4 border-0 p-0">
          <CompetitionFormFields
            form={form}
            locked={!isDraft}
            channels={channelsQuery.data}
            channelAvailability={channelAvailability}
            onRetryChannels={() => {
              void channelsQuery.refetch();
            }}
          />
        </fieldset>
        <EditRecordRefreshWarning
          recordName="competition"
          error={existingQuery.error}
          hasSavedRecord={existing !== undefined}
          onRetry={() => {
            void existingQuery.refetch();
          }}
        />
        <ServerFormError error={error} />
        <FormActions>
          <Button asChild variant="outline">
            <Link to={`/g/${safeGuildId}/competitions`}>Cancel</Link>
          </Button>
          <Button type="reset" variant="ghost" disabled={pending}>
            Reset
          </Button>
          <Button type="submit" disabled={pending || !canSubmit}>
            {recordSubmitLabel(pending, true)}
          </Button>
        </FormActions>
        <FormPendingStatus pending={pending}>
          Saving competition…
        </FormPendingStatus>
      </form>
      <UnsavedFormDialog blocker={blocker} />
    </>
  );

  return (
    <form.AppForm>
      {invalidRoute ? (
        <p className="text-sm text-scout-danger">Invalid competition route.</p>
      ) : isEditWaitingForData ? (
        <EditRecordQueryState
          recordName="competition"
          listHref={`/g/${safeGuildId}/competitions`}
          error={existingQuery.error}
          onRetry={() => {
            void existingQuery.refetch();
          }}
        />
      ) : isEdit ? (
        <div className="max-w-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              Edit competition
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link to={`/g/${safeGuildId}/competitions`}>Back</Link>
            </Button>
          </div>
          {editForm}
        </div>
      ) : (
        <CompetitionCreatePage
          guildId={safeGuildId}
          channels={Loaded.fromQuery(channelsQuery, ["listChannels"])}
          onRetryDependencies={() => {
            void channelsQuery.refetch();
          }}
          onCreated={(createdId) => {
            allowNavigation.current = true;
            void queryClient.invalidateQueries({
              queryKey: trpc.competition.list.pathKey(),
            });
            void navigate(
              `/g/${safeGuildId}/competitions/${createdId.toString()}`,
            );
          }}
        />
      )}
    </form.AppForm>
  );
}

function CompetitionCreatePage(props: {
  guildId: string;
  /**
   * One value in place of `channels` / `channelsLoading` / `channelsError`.
   * Those three could disagree, and the page resolved the disagreement by
   * checking loading first, so a channel list that failed while another
   * dependency was still loading reported "Loading builder…" indefinitely.
   */
  channels: Loaded<{ id: string; name: string }[]>;
  onRetryDependencies: () => void;
  onCreated: (competitionId: number) => void;
}) {
  const channels = props.channels;
  if (channels.status === "loading") {
    return <p className="text-sm text-scout-subtle">Loading builder…</p>;
  }
  if (channels.status === "error") {
    return (
      <div role="alert" className="space-y-2 text-sm text-scout-danger">
        <p>{Loaded.messageOf(channels.errors[0].error)}</p>
        <Button
          type="button"
          variant="outline"
          onClick={props.onRetryDependencies}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (channels.data.length === 0) {
    return (
      <div role="status" className="space-y-2 text-sm text-scout-subtle">
        <p>
          Scout can&apos;t post to any channels in this server. Check its
          channel permissions, then retry.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={props.onRetryDependencies}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          New competition
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${props.guildId}/competitions`}>Back</Link>
        </Button>
      </div>
      <CompetitionBuilder
        guildId={props.guildId}
        channels={channels.data}
        onCreated={props.onCreated}
      />
    </div>
  );
}

function existingToFormState(existing: {
  title: string;
  description: string;
  channelId: string;
  visibility: CompetitionVisibility;
  maxParticipants: number;
  seasonId: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  criteria: CompetitionCriteria;
  analysisTimezone: string;
  gameVariant: CompetitionGameVariant;
}): FormState {
  return {
    title: existing.title,
    description: existing.description,
    channelId: existing.channelId,
    visibility: existing.visibility,
    maxParticipants: existing.maxParticipants.toString(),
    analysisTimezone: existing.analysisTimezone,
    gameVariant: existing.gameVariant,
    dates:
      existing.seasonId === null
        ? {
            mode: "FIXED_DATES",
            startDate:
              existing.startDate === null
                ? ""
                : calendarDateInTimezone(
                    new Date(existing.startDate),
                    existing.analysisTimezone,
                  ),
            endDate:
              existing.endDate === null
                ? ""
                : calendarDateInTimezone(
                    new Date(existing.endDate),
                    existing.analysisTimezone,
                  ),
            seasonId: "",
          }
        : {
            mode: "SEASON",
            startDate: "",
            endDate: "",
            seasonId: existing.seasonId,
          },
    criteria: criteriaToState(existing.criteria),
  };
}

function criteriaToState(criteria: CompetitionCriteria): FormState["criteria"] {
  return {
    criteriaType: criteria.type,
    queues: criteria.queues,
    aggregation:
      criteria.type === "HIGHEST_RANK" || criteria.type === "MOST_RANK_CLIMB"
        ? criteria.aggregation
        : "MAX",
    championId:
      criteria.type === "MOST_WINS_CHAMPION"
        ? criteria.championId.toString()
        : "",
    minGames:
      criteria.type === "HIGHEST_WIN_RATE"
        ? criteria.minGames.toString()
        : "10",
  };
}
