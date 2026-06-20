import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  buildReportPayload,
  EMPTY_REPORT_STATE,
  EXAMPLE_QUERY,
  ReportFormFields,
  type ReportFormState,
} from "#src/components/report-form-fields.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";

const TITLE = "Set up a report";
const DESCRIPTION =
  "A report posts a leaderboard or stats summary to a channel on a schedule. We've pre-filled a weekly Solo Queue leaderboard — tweak it and create.";

function starterReportState(
  channels: { id: string; name: string }[],
): ReportFormState {
  return {
    ...EMPTY_REPORT_STATE,
    title: "Weekly Solo Queue leaderboard",
    channelId: channels[0]?.id ?? "",
    queryText: EXAMPLE_QUERY,
    outputFormat: "LEADERBOARD",
  };
}

export function OnboardingReportStep(props: {
  guildId: string;
  channels: { id: string; name: string }[];
  onCreated: (reportId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trpc = useTRPC();
  const [state, setState] = useState<ReportFormState>(() =>
    starterReportState(props.channels),
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <ReportFormFields
          state={state}
          setState={setState}
          channels={props.channels}
        />
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" type="button" onClick={props.onBack}>
            ← Back
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create report"}
          </Button>
        </div>
      </form>
    </OnboardingShell>
  );
}
