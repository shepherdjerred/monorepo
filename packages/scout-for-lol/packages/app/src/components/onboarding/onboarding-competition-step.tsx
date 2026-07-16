import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  type FormState,
} from "#src/components/competition-form-fields.tsx";
import { validateForm } from "#src/lib/competition-form-state.ts";
import { COMPETITION_EXAMPLES } from "#src/lib/onboarding-examples.ts";
import { OnboardingStepFrame } from "#src/components/onboarding/onboarding-step-frame.tsx";

const TITLE = "Start a competition";
const DESCRIPTION =
  "A competition is a time-boxed race where members rank on one metric. Tweak the example and create.";

function initialState(exampleId: string, channelId: string): FormState {
  const example =
    COMPETITION_EXAMPLES.find((e) => e.id === exampleId) ??
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
  const [state, setState] = useState<FormState>(() =>
    initialState(props.exampleId ?? "", initialChannel),
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.competition.create.mutationOptions({
      onSuccess: (created) => {
        props.onCreated(created.id);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const validated = validateForm(state);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }
    mutation.mutate({
      guildId: props.guildId,
      channelId: state.channelId,
      title: state.title,
      description: state.description,
      visibility: state.visibility,
      maxParticipants: validated.maxParticipants,
      dates: validated.dates,
      criteria: validated.criteria,
    });
  }

  return (
    <OnboardingStepFrame
      step="build-competition"
      title={TITLE}
      description={DESCRIPTION}
      hasChannels={props.channels.length > 0}
      onBack={props.onBack}
      onSkip={props.onSkip}
    >
      <div className="space-y-3">
        <CompetitionFormFields
          guildId={props.guildId}
          isEdit={false}
          locked={false}
          pending={mutation.isPending}
          error={error}
          state={state}
          setState={setState}
          channels={props.channels}
          onSubmit={handleSubmit}
        />
        <Button variant="ghost" type="button" onClick={props.onBack}>
          ← Back
        </Button>
      </div>
    </OnboardingStepFrame>
  );
}
