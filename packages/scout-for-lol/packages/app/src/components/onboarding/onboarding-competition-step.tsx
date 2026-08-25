import { useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { FormActions } from "@scout-for-lol/design-system/components/input";
import { CompetitionBuilderV2 } from "#src/components/competition-builder-v2.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  competitionFormOptions,
  type FormState,
} from "#src/components/competition-form-fields.tsx";
import { OnboardingStepFrame } from "#src/components/onboarding/onboarding-step-frame.tsx";
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
  useUnsavedFormTransition,
} from "#src/hooks/use-unsaved-form.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { validateForm } from "#src/lib/competition-form-state.ts";
import { CompetitionFormValueSchema } from "#src/lib/form-schemas.ts";
import { COMPETITION_EXAMPLES } from "#src/lib/onboarding-examples.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const TITLE = "Start a competition";
const DESCRIPTION =
  "A competition is a time-boxed race where members rank on one metric. Tweak the example and create.";

function initialState(exampleId: string, channelId: string): FormState {
  const example =
    COMPETITION_EXAMPLES.find((candidate) => candidate.id === exampleId) ??
    COMPETITION_EXAMPLES[0];
  return example?.build(channelId) ?? EMPTY_STATE;
}

export function OnboardingCompetitionStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  exampleId: string | null;
  onCreated: (competitionId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const initialChannel = props.channels[0]?.id ?? "";
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [builderDirty, setBuilderDirty] = useState(false);
  const builderQuery = useQuery(
    trpc.competition.builderCapabilities.queryOptions({
      guildId: props.guildId,
    }),
  );

  const mutation = useMutation(
    trpc.competition.create.mutationOptions({
      meta: analyticsMeta("competition_created"),
      onSuccess: (created) => {
        form.reset();
        props.onCreated(created.id);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const form = useScoutForm({
    ...competitionFormOptions,
    defaultValues: initialState(props.exampleId ?? "", initialChannel),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: CompetitionFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = CompetitionFormValueSchema.parse(value);
      const validated = validateForm(parsed);
      if (!validated.ok) throw new Error(validated.message);
      mutation.mutate({
        guildId: props.guildId,
        channelId: parsed.channelId,
        title: parsed.title,
        description: parsed.description,
        visibility: parsed.visibility,
        maxParticipants: validated.maxParticipants,
        gameVariant: parsed.gameVariant,
        dates: validated.dates,
        criteria: validated.criteria,
        analysisTimezone: parsed.analysisTimezone,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const isDirty = useSelector(form.store, (state) => state.isDirty);
  const builderV2Enabled = builderQuery.data?.builderV2Enabled === true;
  const transition = useUnsavedFormTransition(
    builderV2Enabled ? builderDirty : isDirty,
    mutation.isPending,
  );
  const blocker = useUnsavedForm(
    isDirty,
    mutation.isPending,
    transition.isNavigationAllowed,
  );

  if (builderQuery.isLoading) {
    return <p className="text-sm text-scout-subtle">Loading builder…</p>;
  }
  if (builderQuery.error !== null) {
    return (
      <p className="text-sm text-scout-danger">{builderQuery.error.message}</p>
    );
  }

  if (builderV2Enabled) {
    return (
      <OnboardingStepFrame
        step="build-competition"
        title={TITLE}
        description={DESCRIPTION}
        hasChannels={props.channels.length > 0}
        onBack={() => {
          transition.request(props.onBack);
        }}
        onSkip={() => {
          transition.request(props.onSkip);
        }}
      >
        <div className="space-y-3">
          <CompetitionBuilderV2
            guildId={props.guildId}
            channels={props.channels}
            {...(props.exampleId === null
              ? {}
              : { initialScenarioId: props.exampleId })}
            onCreated={props.onCreated}
            onDirtyChange={setBuilderDirty}
            isNavigationAllowed={transition.isNavigationAllowed}
          />
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              transition.request(props.onBack);
            }}
          >
            ← Back
          </Button>
          {transition.dialog}
        </div>
      </OnboardingStepFrame>
    );
  }

  return (
    <OnboardingStepFrame
      step="build-competition"
      title={TITLE}
      description={DESCRIPTION}
      hasChannels={props.channels.length > 0}
      onBack={() => {
        transition.request(props.onBack);
      }}
      onSkip={() => {
        transition.request(props.onSkip);
      }}
    >
      <div className="space-y-3">
        <form.AppForm>
          <form
            ref={formElement}
            className="space-y-5"
            aria-busy={mutation.isPending}
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
            <fieldset
              disabled={mutation.isPending}
              className="m-0 border-0 p-0"
            >
              <CompetitionFormFields
                form={form}
                locked={false}
                channels={props.channels}
              />
            </fieldset>
            <ServerFormError error={error} />
            <FormActions>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  transition.request(props.onBack);
                }}
              >
                ← Back
              </Button>
              <Button type="reset" variant="outline">
                Reset
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create competition"}
              </Button>
            </FormActions>
            <FormPendingStatus pending={mutation.isPending}>
              Creating competition…
            </FormPendingStatus>
          </form>
        </form.AppForm>
        <UnsavedFormDialog blocker={blocker} />
        {transition.dialog}
      </div>
    </OnboardingStepFrame>
  );
}
