/**
 * Web-surface metrics: the HTTP server, the tRPC layer, web auth, and the
 * onboarding funnel. Kept separate from index.ts for the file-length cap;
 * registered on the shared registry.
 *
 * Every label here is deliberately low-cardinality — route patterns, procedure
 * names, and fixed enums only. Never add `guild_id`, `user_id`, a Riot ID, or
 * any other unbounded value: Prometheus keeps a series per label combination.
 */

import { Counter, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * HTTP requests served, by normalized route pattern (see
 * `#src/http/route-label.ts` — never the raw path) and status.
 */
export const httpRequestsTotal = new Counter({
  name: "scout_http_requests_total",
  help: "HTTP requests served by the backend, by route and status",
  labelNames: ["route", "method", "status", "status_class"] as const,
  registers: [registry],
});

/**
 * Wall-clock time to serve a request.
 *
 * `/metrics` is excluded by the caller: `getMetrics()` performs a full DB sweep
 * on every scrape, so including it would make this histogram describe our own
 * scrape cost rather than user-facing latency.
 */
export const httpRequestDuration = new Histogram({
  name: "scout_http_request_duration_seconds",
  help: "Duration of HTTP requests served by the backend in seconds",
  labelNames: ["route"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

/**
 * tRPC calls by procedure and outcome. `code` is `OK` for success, otherwise
 * the TRPCError code (`UNAUTHORIZED`, `INTERNAL_SERVER_ERROR`, …).
 *
 * Recorded from middleware rather than the `onError` hook so successes are
 * counted too — an error *count* without a total is not a rate.
 */
export const trpcCallsTotal = new Counter({
  name: "scout_trpc_calls_total",
  help: "tRPC calls by procedure, type, and result code",
  labelNames: ["procedure", "type", "code"] as const,
  registers: [registry],
});

export const trpcCallDuration = new Histogram({
  name: "scout_trpc_duration_seconds",
  help: "Duration of tRPC procedure calls in seconds",
  labelNames: ["procedure"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

/** Web sign-in funnel: `started` → `succeeded` | `failed` | `callback_error`. */
export const webSigninTotal = new Counter({
  name: "scout_web_signin_total",
  help: "Web sign-in attempts by result",
  labelNames: ["result"] as const,
  registers: [registry],
});

/**
 * Session cookies rejected, by reason (`absent`, `expired`, `invalid`).
 *
 * `absent` is normal anonymous traffic and is expected to dominate; a rise in
 * `expired`/`invalid` is the signal worth alerting on.
 */
export const webSessionRejectedTotal = new Counter({
  name: "scout_web_session_rejected_total",
  help: "Web session validations that did not yield a signed-in user, by reason",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/**
 * Onboarding wizard steps reached, reported by the SPA.
 *
 * `step` is the bounded `OnboardingStepKind` union. Together with
 * {@link onboardingOutcomeTotal} this is the funnel that answers "where do
 * people drop out of setup?" — previously unanswerable, since the web UI had no
 * server-side instrumentation at all.
 */
export const onboardingStepTotal = new Counter({
  name: "scout_onboarding_step_total",
  help: "Onboarding wizard steps reached, by step",
  labelNames: ["step"] as const,
  registers: [registry],
});

/** Terminal onboarding outcome: `completed` or `skipped`. */
export const onboardingOutcomeTotal = new Counter({
  name: "scout_onboarding_outcome_total",
  help: "Onboarding wizard terminal outcomes",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

/**
 * Confirmed guild removals (guildDelete for an *available* guild).
 *
 * Churn was entirely invisible before this existed: a `guilds_left_total`
 * series lingered in Prometheus from an old build but nothing in the codebase
 * incremented it, so removals could only be counted by hand from `DmAuditLog`.
 */
export const guildsLeftTotal = new Counter({
  name: "scout_guilds_left_total",
  help: "Confirmed guild removals (bot kicked, banned, or guild deleted)",
  registers: [registry],
});

/**
 * Why a call to Discord's `/users/@me/guilds` could not be answered.
 *
 * This is the alerting signal for the failure mode where an unreachable Discord
 * used to surface to users as "You are not a member of that guild" — before
 * this metric existed the whole class of failure was invisible in prod.
 */
export const discordUserGuildsFailures = new Counter({
  name: "scout_discord_user_guilds_failures_total",
  help: "Failures fetching the signed-in user's guilds from Discord, by reason",
  labelNames: ["reason"] as const,
  registers: [registry],
});
