/**
 * Telemetry Router
 *
 * Receives the SPA's onboarding-funnel events so they land in Prometheus and
 * can drive Grafana alerts. Matomo already records the same events for
 * behavioural analysis; this exists because Matomo is not an alerting source.
 *
 * This is a PUBLIC, unauthenticated endpoint (the funnel starts before sign-in
 * is complete), so it is deliberately narrow:
 *
 * - event and step names are closed Zod enums, never free-form strings, so a
 *   caller cannot mint arbitrary Prometheus label values;
 * - a per-process rate limit bounds how fast anyone can drive the counters.
 *
 * It accepts no identifiers of any kind — these are counters, not a user trail.
 */

import { z } from "zod";
import { ONBOARDING_STEP_KINDS } from "@scout-for-lol/data";
import { router, publicProcedure } from "#src/trpc/trpc.ts";
import {
  onboardingOutcomeTotal,
  onboardingStepTotal,
} from "#src/metrics/web.ts";

/**
 * Simple fixed-window limiter. The endpoint only feeds counters, so shedding
 * excess events costs a little funnel precision and nothing else — far
 * preferable to letting an unauthenticated caller spin the counters freely.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 600;
let windowStartedAt = Date.now();
let eventsInWindow = 0;

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    eventsInWindow = 0;
  }
  eventsInWindow += 1;
  return eventsInWindow <= RATE_LIMIT_MAX_EVENTS;
}

/** Exposed for tests so the limiter can't leak state between cases. */
export function resetTelemetryRateLimitForTests(): void {
  windowStartedAt = Date.now();
  eventsInWindow = 0;
}

const OnboardingStepSchema = z.enum(ONBOARDING_STEP_KINDS);
const OnboardingOutcomeSchema = z.enum(["completed", "skipped"]);

export const telemetryRouter = router({
  /**
   * Record that the onboarding wizard reached a step. Fires on the initial
   * step and every transition.
   */
  onboardingStep: publicProcedure
    .input(z.object({ step: OnboardingStepSchema }))
    .mutation(({ input }) => {
      if (!withinRateLimit()) return { recorded: false };
      onboardingStepTotal.inc({ step: input.step });
      return { recorded: true };
    }),

  /**
   * Record how onboarding ended. Without this the funnel cannot distinguish a
   * user who finished setup from one who hit "Skip setup" — both simply stop
   * emitting step events.
   */
  onboardingOutcome: publicProcedure
    .input(z.object({ outcome: OnboardingOutcomeSchema }))
    .mutation(({ input }) => {
      if (!withinRateLimit()) return { recorded: false };
      onboardingOutcomeTotal.inc({ outcome: input.outcome });
      return { recorded: true };
    }),
});
