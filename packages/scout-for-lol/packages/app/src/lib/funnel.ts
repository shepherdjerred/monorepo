/**
 * Onboarding funnel reporting.
 *
 * Every funnel event goes to two places on purpose:
 *
 * - **Matomo** (`track`) for behavioural analysis — session context, paths,
 *   segmentation.
 * - **The backend** (`telemetry.*`) so the same counts land in Prometheus,
 *   which is what Grafana alerts on. Matomo is not an alerting source.
 *
 * Both calls are best-effort: telemetry must never break the wizard, so a
 * failed report is swallowed rather than surfaced. Losing a funnel data point
 * is acceptable; blocking someone's setup on an analytics call is not.
 */

import type {
  OnboardingOutcome,
  OnboardingStepKind,
} from "@scout-for-lol/data";
import { track } from "#src/lib/analytics.ts";
import { trpcClient } from "#src/lib/trpc.ts";

export function reportOnboardingStep(step: OnboardingStepKind): void {
  track("onboarding_step", { step });
  void sendStep(step);
}

export function reportOnboardingOutcome(outcome: OnboardingOutcome): void {
  track(
    outcome === "completed" ? "onboarding_completed" : "onboarding_skipped",
  );
  void sendOutcome(outcome);
}

async function sendStep(step: OnboardingStepKind): Promise<void> {
  try {
    await trpcClient.telemetry.onboardingStep.mutate({ step });
  } catch {
    // Intentionally ignored — see module docblock.
  }
}

async function sendOutcome(outcome: OnboardingOutcome): Promise<void> {
  try {
    await trpcClient.telemetry.onboardingOutcome.mutate({ outcome });
  } catch {
    // Intentionally ignored — see module docblock.
  }
}
