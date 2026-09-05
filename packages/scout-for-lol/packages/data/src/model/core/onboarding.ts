/**
 * Onboarding wizard step identifiers.
 *
 * Shared rather than app-local because these values are also Prometheus label
 * values (`scout_onboarding_step_total{step=...}`), reported by the SPA and
 * validated by the backend's telemetry procedure. A single source of truth is
 * what keeps the funnel from silently losing a step if the two drift apart.
 */

import { z } from "zod";

export const ONBOARDING_STEP_KINDS = [
  "install",
  "pick-guild",
  "concepts",
  "subscribe-self",
  "subscribe-more",
  "done",
  "choose-extra",
  "build-report",
  "build-competition",
] as const;

export const OnboardingStepKindSchema = z.enum(ONBOARDING_STEP_KINDS);
export type OnboardingStepKind = z.infer<typeof OnboardingStepKindSchema>;

/** How an onboarding run ended, for the terminal funnel metric. */
export const ONBOARDING_OUTCOMES = ["completed", "skipped"] as const;
export const OnboardingOutcomeSchema = z.enum(ONBOARDING_OUTCOMES);
export type OnboardingOutcome = z.infer<typeof OnboardingOutcomeSchema>;
