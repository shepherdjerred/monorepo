import type { ReactNode } from "react";
import {
  progressLabel,
  progressStep,
  TOTAL_PROGRESS_STEPS,
} from "#src/lib/onboarding-steps.ts";
import type { OnboardingStepKind } from "@scout-for-lol/data";

/**
 * Shared frame for every wizard step: a progress bar, a "Skip setup"
 * escape hatch, and a title/description header. Each step provides its own
 * body + action buttons as children.
 */
export function OnboardingShell(props: {
  step: OnboardingStepKind;
  title: string;
  description?: string;
  onSkip?: () => void;
  children: ReactNode;
}) {
  const current = progressStep(props.step);
  const pct = Math.round((current / TOTAL_PROGRESS_STEPS) * 100);
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-scout-subtle">
            Step {current.toString()} of {TOTAL_PROGRESS_STEPS.toString()} ·{" "}
            {progressLabel(props.step)}
          </p>
          {props.onSkip !== undefined && (
            <button
              type="button"
              onClick={props.onSkip}
              className="min-h-6 px-1 text-sm text-scout-subtle hover:text-scout-ink"
            >
              Skip setup
            </button>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-scout-hover">
          <div
            className="h-full rounded-full bg-scout-brand transition-all"
            style={{ width: `${pct.toString()}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.description !== undefined && (
          <p className="text-sm text-scout-subtle">{props.description}</p>
        )}
      </div>

      {props.children}
    </div>
  );
}
