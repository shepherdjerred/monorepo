import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getSeasonChoices } from "@scout-for-lol/data";
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
  "A competition is a time-boxed race where members rank on one metric. Start from an example, tweak it, and create.";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Latest currently-joinable season (getSeasonChoices filters out ended ones).
const CURRENT_SEASON_ID = getSeasonChoices()[0]?.value ?? "";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type CompetitionExample = {
  id: string;
  label: string;
  build: (channelId: string) => FormState;
};

const EXAMPLES: CompetitionExample[] = [
  {
    id: "rank",
    label: "Highest rank this season",
    build: (channelId) => ({
      ...EMPTY_STATE,
      title: "Highest Solo Queue rank this season",
      description: "Who can climb the highest before the season ends?",
      channelId,
      criteria: {
        criteriaType: "HIGHEST_RANK",
        queue: "SOLO",
        championId: "",
        minGames: "10",
      },
      dates: {
        mode: "SEASON",
        startDate: "",
        endDate: "",
        seasonId: CURRENT_SEASON_ID,
      },
    }),
  },
  {
    id: "games-2026",
    label: "Most games in 2026",
    build: (channelId) => ({
      ...EMPTY_STATE,
      title: "Most games in 2026",
      description: "Rack up the most games this year.",
      channelId,
      criteria: {
        criteriaType: "MOST_GAMES_PLAYED",
        queue: "ALL",
        championId: "",
        minGames: "10",
      },
      dates: {
        mode: "FIXED_DATES",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        seasonId: "",
      },
    }),
  },
  {
    id: "yuumi",
    label: "Most wins on Yuumi",
    build: (channelId) => {
      const now = new Date();
      return {
        ...EMPTY_STATE,
        title: "Most wins on Yuumi",
        description: "Most Yuumi wins over the next month.",
        channelId,
        criteria: {
          criteriaType: "MOST_WINS_CHAMPION",
          queue: "__ANY__",
          championId: "350",
          minGames: "10",
        },
        dates: {
          mode: "FIXED_DATES",
          startDate: toIsoDate(now),
          endDate: toIsoDate(new Date(now.getTime() + THIRTY_DAYS_MS)),
          seasonId: "",
        },
      };
    },
  },
];

export function OnboardingCompetitionStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  onCreated: (competitionId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const initialChannel = props.channels[0]?.id ?? "";
  const [state, setState] = useState<FormState>(
    () => EXAMPLES[0]?.build(initialChannel) ?? EMPTY_STATE,
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
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Start from an example</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <Button
                key={example.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setState(example.build(initialChannel));
                }}
              >
                {example.label}
              </Button>
            ))}
          </div>
        </div>

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
