import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  buildReportPayload,
  EMPTY_REPORT_STATE,
  ReportFormFields,
  type ReportFormState,
} from "#src/components/report-form-fields.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";

const TITLE = "Set up a report";
const DESCRIPTION =
  "A report posts a leaderboard to a channel on a schedule. Start from an example, tweak it, and create.";

type ReportExample = {
  id: string;
  label: string;
  build: (channelId: string) => ReportFormState;
};

const EXAMPLES: ReportExample[] = [
  {
    id: "pairings",
    label: "Best duo pairings",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Best duo pairings",
      channelId,
      queryText:
        "select pair, games, win_rate from player_pairs where games >= 5 group by pair order by win_rate desc",
      outputFormat: "LEADERBOARD",
    }),
  },
  {
    id: "surrender",
    label: "Highest surrender %",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Highest surrender %",
      channelId,
      queryText:
        "select player, games, surrender_rate from match_participants group by player order by surrender_rate desc",
      outputFormat: "LEADERBOARD",
    }),
  },
  {
    id: "games",
    label: "Most games played",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Most games played",
      channelId,
      queryText:
        "select player, games from match_participants group by player order by games desc",
      outputFormat: "LEADERBOARD",
    }),
  },
];

export function OnboardingReportStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  onCreated: (reportId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const initialChannel = props.channels[0]?.id ?? "";
  const [state, setState] = useState<ReportFormState>(
    () => EXAMPLES[0]?.build(initialChannel) ?? EMPTY_REPORT_STATE,
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.report.create.mutationOptions({
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
        step="build-report"
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
    const built = buildReportPayload(state);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    mutation.mutate({
      guildId: props.guildId,
      isEnabled: true,
      ...built.payload,
    });
  }

  return (
    <OnboardingShell
      step="build-report"
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <ReportFormFields
            state={state}
            setState={setState}
            channels={props.channels}
          />
          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex items-center justify-between">
            <Button variant="ghost" type="button" onClick={props.onBack}>
              ← Back
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create report"}
            </Button>
          </div>
        </form>
      </div>
    </OnboardingShell>
  );
}
