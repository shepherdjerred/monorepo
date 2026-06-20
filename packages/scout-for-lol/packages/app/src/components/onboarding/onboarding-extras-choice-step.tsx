import { Button } from "#src/components/ui/button.tsx";
import type { ExtraChoice } from "#src/lib/onboarding-steps.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

const OPTIONS: { value: ExtraChoice; title: string; body: string }[] = [
  {
    value: "report",
    title: "Report",
    body: "A scheduled leaderboard or stats summary that Scout posts to a channel on a recurring schedule (e.g. every week).",
  },
  {
    value: "competition",
    title: "Competition",
    body: "A time-boxed event with a start and end date where members opt in and rank against each other on one metric — there's a winner.",
  },
];

export function OnboardingChooseExtraStep(props: {
  onChoose: (extra: ExtraChoice) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingShell
      step="choose-extra"
      title="Report or competition?"
      description="They're different things — pick whichever fits what you want."
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                props.onChoose(option.value);
              }}
              className="rounded-lg border border-border bg-card p-4 text-left text-card-foreground transition-colors hover:bg-accent"
            >
              <p className="font-semibold">{option.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {option.body}
              </p>
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={props.onBack}>
          ← Back
        </Button>
      </div>
    </OnboardingShell>
  );
}
