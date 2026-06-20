import { Button } from "#src/components/ui/button.tsx";
import { Card, CardContent } from "#src/components/ui/card.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

export function OnboardingDoneStep(props: {
  subCount: number;
  onMore: () => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  return (
    <OnboardingShell
      step="done"
      title="You're all set 🎉"
      description="Scout will post a match report to your channel after every game your tracked players finish."
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 text-sm">
            Now tracking{" "}
            <strong>
              {props.subCount.toString()}{" "}
              {props.subCount === 1 ? "subscription" : "subscriptions"}
            </strong>
            . You can manage everything anytime from the dashboard.
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">
              Want to go further? (optional)
            </p>
            <p className="text-sm text-muted-foreground">
              Set up an automatic leaderboard report, or start a competition
              between your members.
            </p>
            <div className="pt-1">
              <Button onClick={props.onMore}>
                Set up a report or competition
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={props.onBack}>
            ← Back
          </Button>
          <Button variant="outline" onClick={props.onFinish}>
            Finish
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}
