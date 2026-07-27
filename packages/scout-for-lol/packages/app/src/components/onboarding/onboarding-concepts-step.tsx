import { Button } from "#src/components/ui/button.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { ConceptCards } from "#src/components/concept-cards.tsx";
import { OnboardingConceptDiagram } from "#src/components/onboarding/onboarding-concept-diagram.tsx";

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

        <ConceptCards />

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
