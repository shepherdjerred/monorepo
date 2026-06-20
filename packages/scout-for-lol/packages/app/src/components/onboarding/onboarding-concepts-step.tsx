import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingConceptDiagram } from "#src/components/onboarding/onboarding-concept-diagram.tsx";

const CONCEPTS = [
  {
    title: "Player",
    body: "A person you track. A player can hold several Riot accounts and can be linked to a Discord user.",
  },
  {
    title: "Account",
    body: "One League account — a Riot ID (name#TAG) on a region. A player can have multiple.",
  },
  {
    title: "Subscription",
    body: "Posts a player's match reports into a channel. A player can post in more than one channel.",
  },
] as const;

export function OnboardingConceptsStep(props: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingShell
      step="concepts"
      title="How Scout thinks about players"
      description="Three simple ideas. Once they click, the rest is easy."
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        <OnboardingConceptDiagram />

        <div className="grid gap-3 sm:grid-cols-3">
          {CONCEPTS.map((concept) => (
            <Card key={concept.title}>
              <CardHeader className="p-4">
                <CardTitle className="text-base">{concept.title}</CardTitle>
                <CardDescription>{concept.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={props.onBack}>
            ← Back
          </Button>
          <Button onClick={props.onNext}>Got it — next</Button>
        </div>
      </div>
    </OnboardingShell>
  );
}
