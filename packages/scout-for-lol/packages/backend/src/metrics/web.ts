/**
 * Web-surface metrics: the HTTP server, the tRPC layer, web auth, and the
 * onboarding funnel. Kept separate from index.ts for the file-length cap;
 * registered on the shared registry.
 *
 * Every label here is deliberately low-cardinality — route patterns, procedure
 * names, and fixed enums only. Never add `guild_id`, `user_id`, a Riot ID, or
 * any other unbounded value: Prometheus keeps a series per label combination.
 */

import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

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
