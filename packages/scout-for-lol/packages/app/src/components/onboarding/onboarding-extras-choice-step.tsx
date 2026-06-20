import { Button } from "#src/components/ui/button.tsx";
import type { ExtraChoice } from "#src/lib/onboarding-steps.ts";
import {
  COMPETITION_EXAMPLES,
  REPORT_EXAMPLES,
} from "#src/lib/onboarding-examples.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

type Option = {
  value: ExtraChoice;
  title: string;
  body: string;
  examples: { id: string; label: string }[];
};

const OPTIONS: Option[] = [
  {
    value: "report",
    title: "Report",
    body: "A scheduled leaderboard or stats summary that Scout posts to a channel on a recurring schedule (e.g. every week).",
    examples: REPORT_EXAMPLES,
  },
  {
    value: "competition",
    title: "Competition",
    body: "A time-boxed event with a start and end date where members opt in and rank against each other on one metric — there's a winner.",
    examples: COMPETITION_EXAMPLES,
  },
];

export function OnboardingChooseExtraStep(props: {
  onChoose: (extra: ExtraChoice, exampleId: string) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingShell
      step="choose-extra"
      title="Report or competition?"
      description="Two different things — pick an example to start from."
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => (
            <div
              key={option.value}
              className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground"
            >
              <div className="space-y-1">
                <p className="font-semibold">{option.title}</p>
                <p className="text-sm text-muted-foreground">{option.body}</p>
              </div>
              <div className="flex flex-col gap-2">
                {option.examples.map((example) => (
                  <Button
                    key={example.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      props.onChoose(option.value, example.id);
                    }}
                  >
                    {example.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" onClick={props.onBack}>
          ← Back
        </Button>
      </div>
    </OnboardingShell>
  );
}
