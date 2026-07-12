import type { ReactNode } from "react";
import type { OnboardingStepKind } from "#src/lib/onboarding-steps.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";

/**
 * Frame shared by the "build a report" and "build a competition" wizard steps:
 * the {@link OnboardingShell} header plus the identical
 * "no channels available yet" fallback. When `hasChannels` is false the step's
 * body is replaced by the {@link OnboardingNoChannels} back-out; otherwise the
 * step renders its own form as `children`.
 */
export function OnboardingStepFrame(props: {
  step: OnboardingStepKind;
  title: string;
  description: string;
  hasChannels: boolean;
  onBack: () => void;
  onSkip: () => void;
  children: ReactNode;
}) {
  return (
    <OnboardingShell
      step={props.step}
      title={props.title}
      description={props.description}
      onSkip={props.onSkip}
    >
      {props.hasChannels ? (
        props.children
      ) : (
        <OnboardingNoChannels onBack={props.onBack} />
      )}
    </OnboardingShell>
  );
}
