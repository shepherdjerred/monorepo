import { useEffect, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  buildReportPayload,
  EMPTY_REPORT_STATE,
  reportFormOptions,
  ReportFormFields,
  type ReportFormState,
} from "#src/components/report-form-fields.tsx";
import { REPORT_EXAMPLES } from "#src/lib/onboarding-examples.ts";
import { OnboardingStepFrame } from "#src/components/onboarding/onboarding-step-frame.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  ServerFormError,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ReportFormValueSchema } from "#src/lib/form-schemas.ts";
import { FormActions } from "@scout-for-lol/design-system/components/input";
import {
  UnsavedFormDialog,
  useUnsavedForm,
  useUnsavedFormTransition,
} from "#src/hooks/use-unsaved-form.tsx";

const TITLE = "Set up a report";
const DESCRIPTION =
  "A report posts a leaderboard to a channel on a schedule. Tweak the example and create.";

function initialState(exampleId: string, channelId: string): ReportFormState {
  const example =
    REPORT_EXAMPLES.find((e) => e.id === exampleId) ?? REPORT_EXAMPLES[0];
  return example?.build(channelId) ?? EMPTY_REPORT_STATE;
}

export function OnboardingReportStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  exampleId: string | null;
  onCreated: (reportId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const initialChannel = props.channels[0]?.id ?? "";
  const [error, setError] = useState<string | null>(null);
  const [queryEditorOpen, setQueryEditorOpen] = useState(false);
  const formElement = useRef<HTMLFormElement>(null);

  const mutation = useMutation(
    trpc.report.create.mutationOptions({
      meta: analyticsMeta("report_created"),
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
    ...reportFormOptions,
    defaultValues: initialState(props.exampleId ?? "", initialChannel),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReportFormValueSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const built = buildReportPayload(value);
      if (!built.ok) throw new Error(built.message);
      mutation.mutate({
        guildId: props.guildId,
        isEnabled: true,
        ...built.payload,
      });
    },
    onSubmitInvalid: () => {
      setQueryEditorOpen(true);
      focusFirstInvalid(formElement.current);
    },
  });
  const isDirty = useSelector(form.store, (state) => state.isDirty);
  const transition = useUnsavedFormTransition(isDirty, mutation.isPending);
  const blocker = useUnsavedForm(
    isDirty,
    mutation.isPending,
    transition.isNavigationAllowed,
  );

  useEffect(() => {
    form.reset(initialState(props.exampleId ?? "", initialChannel));
    setQueryEditorOpen(false);
  }, [form, initialChannel, props.exampleId]);

  return (
    <OnboardingStepFrame
      step="build-report"
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
      <form.AppForm>
        <form
          ref={formElement}
          onSubmit={(event) => {
            handleFormSubmit(event, () => form.handleSubmit());
          }}
          className="space-y-4"
          aria-busy={mutation.isPending}
        >
          <fieldset disabled={mutation.isPending} className="m-0 border-0 p-0">
            <ReportFormFields
              form={form}
              channels={props.channels}
              queryEditorDisclosure="collapsed"
              queryEditorOpen={queryEditorOpen}
              onQueryEditorOpenChange={setQueryEditorOpen}
            />
          </fieldset>
          <ServerFormError error={error} />
          <FormPendingStatus pending={mutation.isPending}>
            Creating report…
          </FormPendingStatus>
          <FormActions className="justify-between">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                transition.request(props.onBack);
              }}
            >
              ← Back
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create report"}
            </Button>
          </FormActions>
        </form>
      </form.AppForm>
      <UnsavedFormDialog blocker={blocker} />
      {transition.dialog}
    </OnboardingStepFrame>
  );
}
