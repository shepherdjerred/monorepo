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
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";

const TITLE = "Start a competition";
const DESCRIPTION =
  "A competition is a time-boxed race where members rank on one metric. We've pre-filled a two-week 'most games' race — adjust it and create.";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function starterCompetitionState(
  channels: { id: string; name: string }[],
): FormState {
  const now = new Date();
  const end = new Date(now.getTime() + TWO_WEEKS_MS);
  return {
    ...EMPTY_STATE,
    title: "2-week games race",
    description: "Most games played over the next two weeks.",
    channelId: channels[0]?.id ?? "",
    dates: {
      mode: "FIXED_DATES",
      startDate: toIsoDate(now),
      endDate: toIsoDate(end),
      seasonId: "",
    },
  };
}

export function OnboardingCompetitionStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  onCreated: (competitionId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const [state, setState] = useState<FormState>(() =>
    starterCompetitionState(props.channels),
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

  if (props.channels.length === 0) {
    return (
      <OnboardingShell
        step="build-competition"
        title={TITLE}
        description={DESCRIPTION}
        onSkip={props.onSkip}
      >
        <OnboardingNoChannels onBack={props.onBack} />
      </OnboardingShell>
    );
  }

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
    <OnboardingShell
      step="build-competition"
      title={TITLE}
      description={DESCRIPTION}
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
    </OnboardingShell>
  );
}
