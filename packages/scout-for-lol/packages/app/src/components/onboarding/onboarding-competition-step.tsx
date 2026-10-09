import type { DiscordGuildId, DiscordChannelId } from "@scout-for-lol/data";
import { useState } from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import { CompetitionBuilder } from "#src/components/competition/competition-builder.tsx";
import { OnboardingStepFrame } from "#src/components/onboarding/onboarding-step-frame.tsx";
import { useUnsavedFormTransition } from "#src/hooks/use-unsaved-form.tsx";

const TITLE = "Start a competition";
const DESCRIPTION =
  "A competition is a time-boxed race where members rank on one metric. Tweak the example and create.";

export function OnboardingCompetitionStep(props: {
  guildId: DiscordGuildId;
  channels: { id: DiscordChannelId; name: string }[];
  exampleId: string | null;
  onCreated: (competitionId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [builderDirty, setBuilderDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  // While the create request is in flight, step navigation is refused: the
  // competition may already exist, and leaving now would orphan it.
  const transition = useUnsavedFormTransition(builderDirty, creating);

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
        <CompetitionBuilder
          guildId={props.guildId}
          channels={props.channels}
          {...(props.exampleId === null
            ? {}
            : { initialScenarioId: props.exampleId })}
          onCreated={props.onCreated}
          onDirtyChange={setBuilderDirty}
          onPendingChange={setCreating}
          isNavigationAllowed={transition.isNavigationAllowed}
        />
        <Button
          variant="ghost"
          type="button"
          disabled={creating}
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
