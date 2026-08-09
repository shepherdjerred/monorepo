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
import type { Context } from "#src/trpc/context.ts";
import {
  onboardingOutcomeTotal,
  onboardingStepTotal,
} from "#src/metrics/web.ts";

/**
 * Fixed-window limiter, applied **per caller** with a global safety cap on top.
 *
 * A single process-wide counter looked sufficient but was not: one anonymous
 * client could spend the whole per-minute allowance at the top of every window
 * and every other user's onboarding events would be shed for the rest of it —
 * silently replacing the funnel signal with one caller's traffic. The per-caller
 * limit is the primary control; the global cap only bounds total memory and
 * counter churn.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const PER_CALLER_MAX_EVENTS = 40;
const GLOBAL_MAX_EVENTS = 2000;
/** Bounds the key map even under a spray of distinct forged callers. */
const MAX_TRACKED_CALLERS = 5000;

let windowStartedAt = Date.now();
let eventsInWindow = 0;
const eventsByCaller = new Map<string, number>();

function withinRateLimit(callerKey: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    eventsInWindow = 0;
    eventsByCaller.clear();
  }

  // Per-caller FIRST, and charge the global counter only for events that pass
  // it. Charging before this check let a single rejected caller burn the
  // process-wide budget — ~2000 requests in a minute and every legitimate
  // caller got `recorded: false`, which is the starvation the per-caller limit
  // was added to prevent.
  const forCaller = (eventsByCaller.get(callerKey) ?? 0) + 1;
  if (forCaller > PER_CALLER_MAX_EVENTS) return false;
  if (eventsInWindow + 1 > GLOBAL_MAX_EVENTS) return false;

  eventsInWindow += 1;
  // Only track a new key while there is room, so a spray of forged callers
  // cannot grow the map without bound.
  if (forCaller > 1 || eventsByCaller.size < MAX_TRACKED_CALLERS) {
    eventsByCaller.set(callerKey, forCaller);
  }
  return true;
}

/**
 * Identify the caller for rate-limiting. The session id is preferred; anonymous
 * callers fall back to the forwarded client IP. Neither is trusted for
 * authorization — this only decides whose bucket an event is charged to.
 */
function callerKeyFor(ctx: Context): string {
  const sessionId = ctx.webSession?.discordId;
  if (sessionId !== undefined) return `u:${sessionId}`;
  return `ip:${ctx.clientIp ?? "unknown"}`;
}

/** Exposed for tests so the limiter can't leak state between cases. */
export function resetTelemetryRateLimitForTests(): void {
  windowStartedAt = Date.now();
  eventsInWindow = 0;
  eventsByCaller.clear();
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
    .mutation(({ ctx, input }) => {
      if (!withinRateLimit(callerKeyFor(ctx))) return { recorded: false };
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
    .mutation(({ ctx, input }) => {
      if (!withinRateLimit(callerKeyFor(ctx))) return { recorded: false };
      onboardingOutcomeTotal.inc({ outcome: input.outcome });
      return { recorded: true };
    }),
});
