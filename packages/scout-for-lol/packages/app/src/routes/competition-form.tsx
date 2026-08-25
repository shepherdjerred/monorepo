import { useEffect, useRef, useState } from "react";
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
import { FormActions } from "@scout-for-lol/design-system/components/input";
import { CompetitionBuilderV2 } from "#src/components/competition-builder-v2.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  competitionFormOptions,
  type FormState,
} from "#src/components/competition-form-fields.tsx";
import { CompetitionPresets } from "#src/components/competition-presets.tsx";
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
import { validateForm } from "#src/lib/competition-form-state.ts";
import { calendarDateInTimezone } from "#src/lib/competition-time.ts";
import { CompetitionFormValueSchema } from "#src/lib/form-schemas.ts";
import type { CompetitionExample } from "#src/lib/onboarding-examples.ts";
import { useTRPC } from "#src/lib/trpc.ts";

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

  const [prefilled, setPrefilled] = useState(false);
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
  const isDraft = !isEdit || existing?.status === "DRAFT";

  const createMutation = useMutation(
    trpc.competition.create.mutationOptions({
      meta: analyticsMeta("competition_created"),
      onSuccess: (created) => {
        allowNavigation.current = true;
        void queryClient.invalidateQueries({
          queryKey: trpc.competition.list.pathKey(),
        });
        void navigate(
          `/g/${safeGuildId}/competitions/${created.id.toString()}`,
        );
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
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

  const pending = createMutation.isPending || editMutation.isPending;
  const form = useScoutForm({
    ...competitionFormOptions,
    defaultValues: EMPTY_STATE,
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: CompetitionFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = CompetitionFormValueSchema.parse(value);
      const validated = validateForm(parsed);
      if (!validated.ok) throw new Error(validated.message);
      const { maxParticipants, criteria, dates } = validated;
      if (isEdit) {
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
        return;
      }
      createMutation.mutate({
        guildId: safeGuildId,
        channelId: parsed.channelId,
        title: parsed.title,
        description: parsed.description,
        visibility: parsed.visibility,
        maxParticipants,
        gameVariant: parsed.gameVariant,
        dates,
        criteria,
        analysisTimezone: parsed.analysisTimezone,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const isDirty = useSelector(form.store, (state) => state.isDirty);
  const blocker = useUnsavedForm(isDirty && !allowNavigation.current, pending);

  useEffect(() => {
    if (existing === undefined || prefilled) return;
    form.reset(existingToFormState(existing));
    setPrefilled(true);
  }, [existing, form, prefilled]);

  if (guildId === undefined || (isEdit && !idResult.success)) {
    return (
      <p className="text-sm text-scout-danger">Invalid competition route.</p>
    );
  }

  function handleUsePreset(example: CompetitionExample) {
    const previous = form.state.values;
    const chosenChannelId = previous.channelId;
    const channelId =
      chosenChannelId === ""
        ? (channelsQuery.data?.[0]?.id ?? "")
        : chosenChannelId;
    const built = example.build(channelId);
    const next =
      chosenChannelId === "" ? built : { ...built, channelId: chosenChannelId };
    form.setFieldValue("title", next.title);
    form.setFieldValue("description", next.description);
    form.setFieldValue("channelId", next.channelId);
    form.setFieldValue("visibility", next.visibility);
    form.setFieldValue("maxParticipants", next.maxParticipants);
    form.setFieldValue("gameVariant", next.gameVariant);
    form.setFieldValue("analysisTimezone", next.analysisTimezone);
    form.setFieldValue("dates", next.dates);
    form.setFieldValue("criteria", next.criteria);
  }

  const legacyForm = (
    <>
      <form.AppForm>
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
          <fieldset disabled={pending} className="m-0 border-0 p-0">
            <CompetitionFormFields
              form={form}
              locked={isEdit && !isDraft}
              channels={channelsQuery.data}
            />
          </fieldset>
          <ServerFormError error={error} />
          <FormActions>
            <Button asChild variant="outline">
              <Link to={`/g/${guildId}/competitions`}>Cancel</Link>
            </Button>
            <Button type="reset" variant="ghost" disabled={pending}>
              Reset
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create"}
            </Button>
          </FormActions>
          <FormPendingStatus pending={pending}>
            Saving competition…
          </FormPendingStatus>
        </form>
      </form.AppForm>
      <UnsavedFormDialog blocker={blocker} />
    </>
  );

  if (!isEdit) {
    return (
      <CompetitionCreatePage
        guildId={guildId}
        channels={channelsQuery.data}
        channelsLoading={channelsQuery.isLoading}
        channelsError={channelsQuery.error?.message ?? null}
        onUsePreset={handleUsePreset}
        onCreated={(createdId) => {
          allowNavigation.current = true;
          void queryClient.invalidateQueries({
            queryKey: trpc.competition.list.pathKey(),
          });
          void navigate(
            `/g/${safeGuildId}/competitions/${createdId.toString()}`,
          );
        }}
        legacyForm={legacyForm}
      />
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          Edit competition
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${guildId}/competitions`}>Back</Link>
        </Button>
      </div>
      {legacyForm}
    </div>
  );
}

function CompetitionCreatePage(props: {
  guildId: string;
  channels: { id: string; name: string }[] | undefined;
  channelsLoading: boolean;
  channelsError: string | null;
  onUsePreset: (example: CompetitionExample) => void;
  onCreated: (competitionId: number) => void;
  legacyForm: React.ReactNode;
}) {
  const trpc = useTRPC();
  const builderQuery = useQuery(
    trpc.competition.builderCapabilities.queryOptions({
      guildId: props.guildId,
    }),
  );
  if (builderQuery.isLoading || props.channelsLoading) {
    return <p className="text-sm text-scout-subtle">Loading builder…</p>;
  }
  const error = builderQuery.error?.message ?? props.channelsError;
  if (error !== null) {
    return <p className="text-sm text-scout-danger">{error}</p>;
  }

  const usesV2 = builderQuery.data?.builderV2Enabled === true;
  return (
    <div className={`${usesV2 ? "max-w-5xl" : "max-w-2xl"} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          New competition
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${props.guildId}/competitions`}>Back</Link>
        </Button>
      </div>
      {usesV2 ? (
        <CompetitionBuilderV2
          guildId={props.guildId}
          channels={props.channels ?? []}
          onCreated={props.onCreated}
        />
      ) : (
        <>
          <CompetitionPresets onUsePreset={props.onUsePreset} />
          {props.legacyForm}
        </>
      )}
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
